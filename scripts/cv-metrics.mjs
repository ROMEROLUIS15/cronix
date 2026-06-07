// Read-only production metrics snapshot for CV verification.
// Counts/aggregates only — no writes. Run: node scripts/cv-metrics.mjs
// Reads credentials from .env.local (gitignored). No secrets are hardcoded.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Business marked as seed/load-test (566 appointments, 1 client). Excluded from "real" tallies.
const SEED_BUSINESS = 'a1c1897d-6bce-4df9-9d80-40a0836cbeb1'

async function count(table, filter) {
  let q = sb.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  return error ? `ERR(${error.message})` : count
}

async function perBiz(table) {
  const { data } = await sb.from(table).select('business_id').limit(10000)
  const m = {}
  for (const r of data || []) m[r.business_id] = (m[r.business_id] || 0) + 1
  return m
}

async function range(table, col = 'created_at') {
  const a = await sb.from(table).select(col).order(col, { ascending: true }).limit(1)
  const b = await sb.from(table).select(col).order(col, { ascending: false }).limit(1)
  return { first: a.data?.[0]?.[col] ?? null, last: b.data?.[0]?.[col] ?? null }
}

const tables = [
  'businesses', 'users', 'clients', 'services', 'appointments',
  'transactions', 'expenses', 'saas_invoices', 'notifications',
  'wa_sessions', 'ai_traces', 'ai_tool_audit_log', 'wa_audit_logs',
  'appointment_reminders',
]

console.log('=== TABLE COUNTS (raw, incl. seed) ===')
for (const t of tables) console.log(String(await count(t)).padStart(8), t)

console.log('\n=== REAL counts (excluding seed business) ===')
for (const t of ['appointments', 'transactions', 'clients']) {
  console.log(String(await count(t, (q) => q.neq('business_id', SEED_BUSINESS))).padStart(8), t)
}

console.log('\n=== per business ===')
for (const t of ['appointments', 'transactions', 'clients', 'ai_traces']) {
  console.log(t, await perBiz(t))
}

console.log('\n=== appointments by status (real, excl. seed) ===')
for (const s of ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']) {
  console.log(
    String(await count('appointments', (q) => q.eq('status', s).neq('business_id', SEED_BUSINESS))).padStart(8),
    s,
  )
}

console.log('\n=== users linked vs orphan ===')
{
  const linked = await count('users', (q) => q.not('business_id', 'is', null))
  const orphan = await count('users', (q) => q.is('business_id', null))
  console.log({ linked, orphan })
}

console.log('\n=== ai_traces by outcome ===')
for (const o of ['success', 'failure', 'no_action', 'rate_limited', 'error']) {
  console.log(String(await count('ai_traces', (q) => q.eq('outcome', o))).padStart(8), o)
}

console.log('\n=== ai_traces latency/tokens ===')
{
  const { data } = await sb.from('ai_traces').select('latency_ms,total_tokens').limit(10000)
  if (data?.length) {
    const lat = data.map((r) => r.latency_ms).sort((a, b) => a - b)
    const p = (q) => lat[Math.floor(lat.length * q)] ?? 0
    console.log({
      rows: data.length,
      p50_ms: p(0.5),
      p95_ms: p(0.95),
      total_tokens: data.reduce((s, r) => s + (r.total_tokens || 0), 0),
    })
  }
}

console.log('\n=== date ranges ===')
for (const t of ['businesses', 'appointments', 'transactions', 'ai_traces']) {
  console.log(t, await range(t))
}

console.log('\nNOTE: Helicone (LLM volume/cost), Sentry (crash-free/p95) and Vercel (traffic/uptime) live in their dashboards, not here.')
process.exit(0)
