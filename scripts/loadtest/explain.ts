/**
 * explain.ts — Bottleneck finder for the dashboard's hot queries.
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS) on the representative read paths against a
 * seeded business and prints a ranked summary: execution time + any Seq Scan on
 * a large relation (the classic "missing index / wrong predicate" smell).
 *
 * These are the inner queries the SECURITY DEFINER RPCs and PostgREST reads run;
 * EXPLAINing them directly (rather than the function call) exposes the real plan.
 *
 * Run after seeding (local stack up):  npx tsx scripts/loadtest/explain.ts
 */
import { connect } from './db'

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Actual Rows'?: number
  Plans?: PlanNode[]
}
interface ExplainResult { Plan: PlanNode; 'Execution Time': number; 'Planning Time': number }

function collectSeqScans(node: PlanNode, out: { rel: string; rows: number }[]): void {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
    out.push({ rel: node['Relation Name'], rows: node['Actual Rows'] ?? 0 })
  }
  for (const child of node.Plans ?? []) collectSeqScans(child, out)
}

async function explain(db: Awaited<ReturnType<typeof connect>>, label: string, sql: string, params: unknown[]) {
  const res = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)
  const plan = (res.rows[0] as Record<string, ExplainResult[]>)['QUERY PLAN']![0]!
  const seqScans: { rel: string; rows: number }[] = []
  collectSeqScans(plan.Plan, seqScans)
  // Only flag scans over a non-trivial number of rows — small lookups are fine.
  const bigScans = seqScans.filter(s => s.rows > 1000)
  return { label, execMs: plan['Execution Time'], planMs: plan['Planning Time'], bigScans }
}

async function main() {
  const db = await connect()
  try {
    const bizRes = await db.query<{ id: string }>(
      `SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %' ORDER BY name LIMIT 1`)
    const biz = bizRes.rows[0]?.id
    if (!biz) { console.error('No LoadTest data found — run seed.ts first.'); process.exit(1) }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const monthStartDate = monthStart.slice(0, 10)

    const cases: { label: string; sql: string; params: unknown[] }[] = [
      {
        label: 'dashboard · month appointments (w/ joins)',
        sql: `SELECT a.id, a.start_at, a.status, s.name, s.price, c.name
              FROM public.appointments a
              JOIN public.services s ON s.id = a.service_id
              JOIN public.clients  c ON c.id = a.client_id
              WHERE a.business_id = $1 AND a.start_at >= $2 AND a.start_at <= $3
              ORDER BY a.start_at DESC`,
        params: [biz, monthStart, monthEnd],
      },
      {
        label: 'metrics · billed (completed appts list price)',
        sql: `SELECT COALESCE(SUM(s.price),0) FROM public.appointments a
              JOIN public.services s ON s.id = a.service_id
              WHERE a.business_id = $1 AND a.status = 'completed' AND a.start_at >= $2 AND a.start_at < $3`,
        params: [biz, monthStart, monthEnd],
      },
      {
        label: 'metrics · collected (net_amount by appt date)',
        sql: `SELECT COALESCE(SUM(t.net_amount),0)
              FROM public.transactions t
              LEFT JOIN public.appointments a ON a.id = t.appointment_id AND a.business_id = $1
              WHERE t.business_id = $1
                AND ((a.id IS NOT NULL AND a.start_at >= $2 AND a.start_at < $3)
                  OR (a.id IS NULL AND t.paid_at >= $2 AND t.paid_at < $3))`,
        params: [biz, monthStart, monthEnd],
      },
      {
        label: 'metrics · expenses (by expense_date)',
        sql: `SELECT COALESCE(SUM(amount),0) FROM public.expenses
              WHERE business_id = $1 AND expense_date >= $2::date AND expense_date < ($2::date + interval '1 month')`,
        params: [biz, monthStartDate],
      },
      {
        label: 'clients · active list (ordered by name)',
        sql: `SELECT id, name FROM public.clients
              WHERE business_id = $1 AND deleted_at IS NULL ORDER BY name LIMIT 50`,
        params: [biz],
      },
      {
        label: 'get_clients_debts · inner aggregation',
        sql: `WITH apt_costs AS (
                SELECT a.client_id, COALESCE(SUM(s.price),0) AS expected
                FROM public.appointments a
                JOIN public.appointment_services aps ON aps.appointment_id = a.id
                JOIN public.services s ON s.id = aps.service_id
                WHERE a.business_id = $1 AND a.status NOT IN ('cancelled','no_show') AND a.start_at < now()
                GROUP BY a.client_id)
              SELECT count(*) FROM apt_costs`,
        params: [biz],
      },
    ]

    console.log(`🔎 EXPLAIN ANALYZE against business ${biz}\n`)
    const results = []
    for (const c of cases) results.push(await explain(db, c.label, c.sql, c.params))
    results.sort((a, b) => b.execMs - a.execMs)

    console.log('  exec(ms)  plan(ms)  query')
    console.log('  ────────  ────────  ─────────────────────────────────────────────')
    for (const r of results) {
      const flag = r.bigScans.length ? `  ⚠️ Seq Scan: ${r.bigScans.map(s => `${s.rel}(${s.rows.toLocaleString()} rows)`).join(', ')}` : ''
      console.log(`  ${r.execMs.toFixed(2).padStart(8)}  ${r.planMs.toFixed(2).padStart(8)}  ${r.label}${flag}`)
    }
    console.log('\n  ⚠️ = sequential scan over >1000 rows → likely a missing/unused index on that path.')
  } finally {
    await db.end()
  }
}

main().catch(err => { console.error('❌', err instanceof Error ? err.message : err); process.exit(1) })
