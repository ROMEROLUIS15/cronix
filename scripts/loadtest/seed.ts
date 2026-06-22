/**
 * seed.ts — Set-based load-test seeder for the LOCAL Supabase stack.
 *
 * Generates realistic multi-tenant volume (businesses → owners → services →
 * clients → appointments → appointment_services → transactions → expenses) with
 * pure INSERT … SELECT generate_series, so a million rows land in seconds.
 *
 * Scale is parametrised via env (all optional):
 *   LT_BUSINESSES        number of tenant businesses          (default 500)
 *   LT_CLIENTS_PER       clients per business                 (default 150)
 *   LT_SERVICES_PER      services per business                (default 6)
 *   LT_APPTS_PER_CLIENT  appointments per client              (default 8)
 *
 * Run (local stack must be up — `supabase start`):
 *   npx tsx scripts/loadtest/seed.ts
 *   LT_BUSINESSES=100 LT_CLIENTS_PER=50 npx tsx scripts/loadtest/seed.ts
 *
 * Re-running ADDS another batch (every row is tagged 'LoadTest …'); clean up with
 * `npx tsx scripts/loadtest/seed.ts --reset` to delete all LoadTest data first.
 */
import { connect, envInt } from './db'

const RESET = process.argv.includes('--reset')

const N_BIZ        = envInt('LT_BUSINESSES', 500)
const CLIENTS_PER  = envInt('LT_CLIENTS_PER', 150)
const SERVICES_PER = envInt('LT_SERVICES_PER', 6)
const APPTS_PER    = envInt('LT_APPTS_PER_CLIENT', 8)

async function main() {
  const db = await connect()
  try {
    if (RESET) {
      console.log('🧹 Deleting previous LoadTest data…')
      // Children first (FKs). LoadTest businesses are tagged by name prefix.
      await db.query(`
        WITH b AS (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')
        DELETE FROM public.appointment_services aps
        USING public.appointments a
        WHERE aps.appointment_id = a.id AND a.business_id IN (SELECT id FROM b)`)
      await db.query(`DELETE FROM public.transactions WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
      await db.query(`DELETE FROM public.appointments WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
      await db.query(`DELETE FROM public.expenses WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
      await db.query(`DELETE FROM public.clients WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
      await db.query(`DELETE FROM public.services WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
      await db.query(`DELETE FROM public.users WHERE name LIKE 'LoadTest Owner %'`)
      await db.query(`DELETE FROM public.businesses WHERE name LIKE 'LoadTest Biz %'`)
      console.log('✅ Reset done.')
      return
    }

    console.log(`🌱 Seeding: ${N_BIZ} businesses × ${CLIENTS_PER} clients × ${APPTS_PER} appts/client (${SERVICES_PER} services each)`)
    const t0 = Date.now()
    await db.query('BEGIN')

    // 1. businesses + owners. owner_id has no enforced FK, so businesses go first.
    await db.query(
      `CREATE TEMP TABLE lt_biz ON COMMIT DROP AS
         SELECT gen_random_uuid() AS business_id, gen_random_uuid() AS owner_id, g AS idx
         FROM generate_series(1, $1::int) g`, [N_BIZ])
    await db.query(
      `INSERT INTO public.businesses (id, name, category, owner_id)
         SELECT business_id, 'LoadTest Biz '||idx, 'salon', owner_id FROM lt_biz`)
    await db.query(
      `INSERT INTO public.users (id, name, role, business_id)
         SELECT owner_id, 'LoadTest Owner '||idx, 'owner', business_id FROM lt_biz`)

    // 2. services per business
    await db.query(
      `CREATE TEMP TABLE lt_svc ON COMMIT DROP AS
         SELECT gen_random_uuid() AS service_id, b.business_id, s AS svc_idx,
                (20 + s * 5)::numeric AS price
         FROM lt_biz b CROSS JOIN generate_series(1, $1::int) s`, [SERVICES_PER])
    await db.query(
      `INSERT INTO public.services (id, business_id, name, duration_min, price)
         SELECT service_id, business_id, 'Service '||svc_idx, 30, price FROM lt_svc`)

    // 3. clients per business
    await db.query(
      `CREATE TEMP TABLE lt_cli ON COMMIT DROP AS
         SELECT gen_random_uuid() AS client_id, b.business_id, c AS cli_idx
         FROM lt_biz b CROSS JOIN generate_series(1, $1::int) c`, [CLIENTS_PER])
    await db.query(
      `INSERT INTO public.clients (id, business_id, name)
         SELECT client_id, business_id, 'Client '||cli_idx FROM lt_cli`)

    // 4. appointments per client — round-robin a service from the same business,
    //    spread over the past ~year, with a realistic status mix.
    await db.query(
      `CREATE TEMP TABLE lt_appt ON COMMIT DROP AS
         SELECT gen_random_uuid() AS appt_id, cl.business_id, cl.client_id, sv.service_id, sv.price,
                date_trunc('hour', now()) - ((a * 11) || ' days')::interval AS start_at,
                a AS appt_idx,
                (CASE WHEN a % 7 = 0 THEN 'cancelled'
                      WHEN a % 5 = 0 THEN 'pending'
                      WHEN a % 9 = 0 THEN 'no_show'
                      ELSE 'completed' END) AS status
         FROM lt_cli cl
         CROSS JOIN generate_series(1, $1::int) a
         JOIN lt_svc sv ON sv.business_id = cl.business_id AND sv.svc_idx = 1 + (a % $2::int)`,
      [APPTS_PER, SERVICES_PER])
    await db.query(
      `INSERT INTO public.appointments (id, business_id, client_id, service_id, start_at, end_at, status)
         SELECT appt_id, business_id, client_id, service_id, start_at, start_at + interval '30 min',
                status::public.appointment_status
         FROM lt_appt`)

    // 5. multi-service junction (get_clients_debts reads this). A DB trigger may
    //    already mirror appointments.service_id here, so tolerate conflicts.
    await db.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id)
         SELECT appt_id, service_id FROM lt_appt
       ON CONFLICT (appointment_id, service_id) DO NOTHING`)

    // 6. transactions — ~70% of completed appointments are paid in full
    await db.query(
      `INSERT INTO public.transactions (business_id, appointment_id, amount, net_amount, method, paid_at)
         SELECT business_id, appt_id, price, price, 'cash'::public.payment_method, start_at + interval '30 min'
         FROM lt_appt
         WHERE status = 'completed' AND appt_idx % 10 < 7`)

    // 7. expenses — 12 per business across the year
    await db.query(
      `INSERT INTO public.expenses (business_id, amount, category, expense_date)
         SELECT business_id, (50 + e * 13)::numeric, 'supplies'::public.expense_category,
                (current_date - (e * 30))
         FROM lt_biz CROSS JOIN generate_series(1, 12) e`)

    await db.query('COMMIT')

    // CRITICAL: refresh planner statistics. Right after a bulk load the stats are
    // stale, and the planner can pick catastrophic plans (observed: get_clients_debts
    // at ~6 MINUTES vs ~16ms once analyzed) until autovacuum's autoanalyze catches
    // up. This is the same ANALYZE you must run after any real bulk import/restore.
    console.log('📊 Running ANALYZE (fresh statistics → realistic query plans)…')
    await db.query('ANALYZE public.appointments, public.appointment_services, public.transactions, public.clients, public.services, public.expenses')

    const secs = ((Date.now() - t0) / 1000).toFixed(1)

    const counts = await db.query<{ relname: string; n: string }>(
      `SELECT 'businesses' relname, count(*)::text n FROM public.businesses WHERE name LIKE 'LoadTest Biz %'
       UNION ALL SELECT 'clients',      count(*)::text FROM public.clients      WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')
       UNION ALL SELECT 'appointments', count(*)::text FROM public.appointments WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')
       UNION ALL SELECT 'transactions', count(*)::text FROM public.transactions WHERE business_id IN (SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %')`)
    console.log(`✅ Seeded in ${secs}s`)
    for (const r of counts.rows) console.log(`   ${r.relname.padEnd(13)} ${Number(r.n).toLocaleString()}`)
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await db.end()
  }
}

main().catch(err => { console.error('❌', err instanceof Error ? err.message : err); process.exit(1) })
