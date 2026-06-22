// k6-dashboard.js — Concurrency test for the dashboard read path (LOCAL only).
//
// Ramps virtual users against the local PostgREST RPC and reports the latency
// curve + error rate. Uses the local service_role key (well-known dev default,
// NOT a secret) so the call clears the tenant guard and measures DB+PostgREST
// throughput. RLS overhead is therefore NOT included — this is a DB/API ceiling
// probe, not an auth-path probe.
//
// Prereqs: k6 installed (https://k6.io/docs/get-started/installation) + seeded data.
//
// Run:
//   SERVICE_KEY=<local service_role key from `supabase status`> \
//   BUSINESS_ID=<a seeded business id> \
//   k6 run scripts/loadtest/k6-dashboard.js
//
// Get a BUSINESS_ID:
//   psql <local> -c "select id from businesses where name like 'LoadTest Biz %' limit 1;"

import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.PGRST_URL || 'http://127.0.0.1:54321'
const KEY  = __ENV.SERVICE_KEY
const BIZ  = __ENV.BUSINESS_ID

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // warm up
    { duration: '30s', target: 50 },   // moderate
    { duration: '30s', target: 100 },  // heavy
    { duration: '15s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // p95 under 500ms
    http_req_failed:   ['rate<0.01'], // <1% errors
  },
}

const monthStart = (() => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
})()

export default function () {
  if (!KEY || !BIZ) throw new Error('Set SERVICE_KEY and BUSINESS_ID env vars (see header).')

  const res = http.post(
    `${BASE}/rest/v1/rpc/fn_get_monthly_metrics`,
    JSON.stringify({ p_business_id: BIZ, p_month_start: monthStart }),
    { headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
  check(res, { 'status is 200': r => r.status === 200 })
  sleep(0.5)
}
