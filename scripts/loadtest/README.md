# Load-test harness (LOCAL only)

Capacity / bottleneck experiment for the dashboard read paths. **Runs only against
the local Docker Supabase stack — never the cloud/free-tier project.** `db.ts`
hard-fails on any non-`127.0.0.1` host, so you can't point it at prod by accident.

## Why local
The local stack is real Postgres + PostgREST + the same schema, RLS, RPCs and
indexes as prod. It costs nothing and consumes zero free-tier resources. What
transfers from local to prod is the **shape** of the scaling (slow queries,
missing indexes, seq scans); the only thing it can't tell you is the absolute
concurrency ceiling tied to prod's small compute tier — read that from the
[Supabase tier limits](https://supabase.com/docs/guides/platform/compute-add-ons)
and extrapolate from the curve here.

## 0. Bring up the stack
```bash
supabase start
```

## 1. Seed realistic volume
```bash
# defaults: 500 businesses × 150 clients × 8 appts/client × 6 services
npx tsx scripts/loadtest/seed.ts

# custom scale
LT_BUSINESSES=200 LT_CLIENTS_PER=100 LT_APPTS_PER_CLIENT=10 npx tsx scripts/loadtest/seed.ts

# wipe all LoadTest data
npx tsx scripts/loadtest/seed.ts --reset
```
Env knobs: `LT_BUSINESSES`, `LT_CLIENTS_PER`, `LT_SERVICES_PER`, `LT_APPTS_PER_CLIENT`.
All rows are tagged `LoadTest …` so `--reset` removes them cleanly without touching
any real data.

## 2. Find the bottlenecks (data-volume / query plans)
```bash
npx tsx scripts/loadtest/explain.ts
```
Runs `EXPLAIN (ANALYZE, BUFFERS)` on the hot queries and prints them ranked by
execution time, flagging any **Seq Scan over >1000 rows** (the classic
missing/unused-index smell). This is the highest-signal step — start here.

## 3. Concurrency (optional — needs k6)
```bash
SERVICE_KEY=<local service_role key from `supabase status`> \
BUSINESS_ID=<a seeded business id> \
k6 run scripts/loadtest/k6-dashboard.js
```
Ramps 20→50→100 virtual users and reports the p95/p99 latency curve + error rate.
Uses the local service_role key (a dev default, not a secret), so it measures the
DB+PostgREST ceiling, not RLS/auth overhead.

## How to read it
- **A query that grows ~linearly with row count** → missing index or a predicate
  that can't use one. The flagged Seq Scan tells you which table.
- **p95 that climbs sharply as VUs rise** while single-query time stays flat →
  you're hitting connection/pool or compute saturation, not a query problem.
- Remember the local box is beefier than the free tier: treat absolute numbers as
  optimistic, the **trends** as faithful.

## Safety
- `LOADTEST_DATABASE_URL` overrides the target, but only `127.0.0.1`/`localhost`
  is accepted. Anything else aborts immediately.
- This harness writes a lot of rows — only ever run it on a throwaway local DB.
