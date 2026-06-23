/**
 * load.ts — Concurrency probe for the dashboard read path (LOCAL only, no k6).
 *
 * Ramps concurrent virtual users against the local PostgREST RPC
 * `fn_get_monthly_metrics` and prints the latency curve (p50/p95/p99), error
 * rate and throughput per stage. It auto-discovers the local API URL + key from
 * `supabase status`, so it's turnkey: `npm run loadtest:load`.
 *
 * It calls with the local service_role key, so it measures the DB + PostgREST +
 * connection-pool ceiling — NOT RLS/auth overhead (that's a small constant on
 * top). The saturation point you're hunting for shows up here regardless.
 *
 * Stages are configurable: LT_STAGES="10,25,50,100" LT_STAGE_SECS=8
 */
import { execSync } from 'node:child_process'
import { connect } from './db'

interface LocalStatus { API_URL: string; SERVICE_ROLE_KEY: string }

function localStatus(): LocalStatus {
  const raw = execSync('supabase status -o json', { encoding: 'utf8' })
  const s = JSON.parse(raw) as Record<string, string>
  const API_URL = s.API_URL ?? s.api_url
  const SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY ?? s.service_role_key
  if (!API_URL || !SERVICE_ROLE_KEY) throw new Error('Could not read API_URL/SERVICE_ROLE_KEY from `supabase status` — is the stack up?')
  if (!/127\.0\.0\.1|localhost/.test(API_URL)) throw new Error(`Refusing non-local API_URL ${API_URL}`)
  return { API_URL, SERVICE_ROLE_KEY }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

async function runStage(url: string, key: string, body: string, vus: number, secs: number) {
  const deadline = Date.now() + secs * 1000
  const latencies: number[] = []
  let errors = 0
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }

  async function worker() {
    while (Date.now() < deadline) {
      const t = performance.now()
      try {
        const res = await fetch(url, { method: 'POST', headers, body })
        await res.text()
        if (!res.ok) errors++
      } catch { errors++ }
      latencies.push(performance.now() - t)
    }
  }
  await Promise.all(Array.from({ length: vus }, worker))

  latencies.sort((a, b) => a - b)
  const total = latencies.length
  return {
    vus,
    reqs: total,
    rps: (total / secs).toFixed(0),
    errPct: ((errors / Math.max(total, 1)) * 100).toFixed(1),
    p50: percentile(latencies, 50).toFixed(1),
    p95: percentile(latencies, 95).toFixed(1),
    p99: percentile(latencies, 99).toFixed(1),
  }
}

async function main() {
  const stages = (process.env.LT_STAGES ?? '10,25,50,100').split(',').map(s => parseInt(s, 10))
  const secs = Number(process.env.LT_STAGE_SECS ?? 8)

  const { API_URL, SERVICE_ROLE_KEY } = localStatus()

  // Pick a seeded business via the DB (also enforces the 127.0.0.1 guard).
  const db = await connect()
  const biz = (await db.query<{ id: string }>(
    `SELECT id FROM public.businesses WHERE name LIKE 'LoadTest Biz %' ORDER BY name LIMIT 1`)).rows[0]?.id
  await db.end()
  if (!biz) { console.error('No LoadTest data — run `npm run loadtest:seed` first.'); process.exit(1) }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const url = `${API_URL}/rest/v1/rpc/fn_get_monthly_metrics`
  const body = JSON.stringify({ p_business_id: biz, p_month_start: monthStart })

  console.log(`⚡ Concurrency probe → ${url}`)
  console.log(`   business ${biz} · ${secs}s per stage\n`)
  console.log('  VUs   reqs    req/s   err%    p50(ms)   p95(ms)   p99(ms)')
  console.log('  ────  ──────  ──────  ──────  ────────  ────────  ────────')
  for (const vus of stages) {
    const r = await runStage(url, SERVICE_ROLE_KEY, body, vus, secs)
    console.log(`  ${String(r.vus).padEnd(4)}  ${String(r.reqs).padEnd(6)}  ${r.rps.padStart(6)}  ${r.errPct.padStart(5)}%  ${r.p50.padStart(8)}  ${r.p95.padStart(8)}  ${r.p99.padStart(8)}`)
  }
  console.log('\n  Watch where p95/p99 starts climbing or err% rises — that\'s your concurrency ceiling.')
  console.log('  Local hardware is beefier than the free tier, so treat absolute numbers as optimistic.')
}

main().catch(err => { console.error('❌', err instanceof Error ? err.message : err); process.exit(1) })
