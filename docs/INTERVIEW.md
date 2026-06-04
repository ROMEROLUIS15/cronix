# Cronix — Interview Prep (EN)

> Moved from `docs/architecture/TECHNICAL_DOCUMENTATION.md` §28–29.
> Exact mirror: `INTERVIEW_ES.md` (ES).

---

## 1. Architectural decisions (FAQ)

### Why two runtimes instead of a unified monorepo?

Supabase Edge Functions run on Deno. Deno has its own module resolver (`.ts` explicit in imports), doesn't understand `@/` paths, and uses `Deno.env`. Forcing a single runtime would force me to:
- Bundle Node → Edge with esbuild → high deploy latency + painful debug.
- Or abandon Edge Functions and use Vercel Cron (more expensive and higher latency when fetching to Postgres).

The option I took (two runtimes with duplicated `_shared/` + parity tests) is the balance between simplicity and reuse.

### Why RLS as the structural base?

A `businessId: string` is indistinguishable from "any string" to TypeScript, so the
real gate is the database: RLS (`current_business_id()` derived from the JWT) blocks
cross-tenant reads/writes regardless of application code, and every repository also
filters by `business_id`. Two type-level / per-tool guards were prototyped to make
the check harder to forget (a phantom-typed `TenantContext`, and a per-tool
`tenantGuard.verify()` in the Node AI tools) but the AI tool layer was never wired
to production and was removed (see ADR-0006). `tenantGuard.verify()` survives only on
the one live AI read tool, `get_today_summary`.

### Why fail-open in the reviewer?

The reviewer is layer 5 — the first 4 already suffice to guarantee correctness. If the reviewer fails (Groq timeout, malformed JSON, etc.), blocking legitimate bookings is a higher cost than letting one anomalous edge case through. Traces record every fail-open for audit.

### Why explicit opt-in `PAYPAL_ENV=live`?

Vercel injects `NODE_ENV=production` in ALL deploys, including PR previews. If we trusted `NODE_ENV` as the signal, every PR a collaborator pushes **would charge real money** on its preview deploy.

### Why deterministic template in WA success path instead of LLM?

Historical: when the 70B had to synthesize the final reply after a successful tool, it sometimes responded with 400 (rate-limit) → circuit-breaker opened → 503 → client without reply. The deterministic template (`renderBookingSuccessTemplate`) eliminates that failure point.

### Why Zod as single source of truth?

Each tool has a Zod schema. That schema serves **simultaneously** as:
1. Runtime payload validator (`safeParse` before DB).
2. `function.parameters` definition for the LLM.

If you change a schema field, **both consumers update automatically**.

### Why does the confirmation gate pass empty tools instead of sanitizing output?

Sanitizing output is reactive: the model already thought up the tool, emitted it as text, and we erase it. Passing `tools=[]` is preventive: the model **doesn't see** the schemas → cannot "hallucinate" them. You remove the hallucination surface entirely.

### Why is `recall` mandatory and throws if missing?

The reviewer requires `recentMemory` as input for judgment. Accidentally passing `undefined` would mean the reviewer judges without context and could block legitimate bookings. The "always recall once per turn" rule guarantees that **the reviewer always sees the real memory (or an explicit empty array)**.

### Why `FOR UPDATE` instead of `INSERT ... ON CONFLICT`?

`ON CONFLICT` solves the "insert the same row twice" case, but here the problem is different: the row already exists (`saas_invoices` with `paypal_order_id`), and two callers want to **update** it simultaneously. `FOR UPDATE` is the correct primitive.

### Why `business_id` in each repository, if RLS already filters?

Defense in depth. If a future migration accidentally disables RLS, the repository still filters. If a repository is mistakenly called with service_role (which bypasses RLS), the explicit filter in code still protects.

### Why separate episodic memory + observability instead of one table?

Different life cycles:
- **Memory** is model input → must be easily "recallable" by similarity + scope. Compact table, indexed by `(business_id, actor_kind, actor_key)` + IVFFLAT vector.
- **Traces** are model output → structured metadata for BI + training.

### Why zero-PII in the training export?

A contractual promise to the businesses: "your client data doesn't leave your tenant". The pure transform to `TrainingSample` is restricted by TypeScript to structural fields — it can't leak PII even by accident.

### Why two versions of the WhatsApp agent (8B decider + 70B synthesis)?

- 8B is faster and cheaper for the ReAct loop.
- 70B produces more natural replies.
- Today the 70B is mostly skipped (deterministic template) on success.

### Why CSV key rotation in `LLM_API_KEY`?

Groq's free tier is measured per key. Having several keys ($0 each) lets us saturate gradually without touching paid plans.

### Why Deepgram instead of OpenAI Whisper?

- **Latency**: Deepgram Nova-2 ~300-700ms vs Whisper ~1-2s.
- **Keywords boost**: Deepgram accepts a list of words to bias.
- **$200 free tier**: many minutes.
- **Aura-2 TTS in neutral Spanish**: competitive voice, <500ms latency.

---

## 2. Defense script by level

### Junior

"Cronix is a multi-tenant SaaS for booking appointments via WhatsApp and a dashboard with a voice assistant. It's built with Next.js 15, React 19, TypeScript, Tailwind, Supabase (Postgres + Edge Functions + RLS) and Upstash (Redis + QStash). I wrote the dashboard frontend, payment server actions, repositories against Supabase, and unit tests. The most interesting thing I learned: how to isolate tenants with Postgres RLS plus a per-tool tenant guard, and how to avoid duplicate bookings with a per-turn fingerprint."

### Middle

"The stack is Next.js 15 (App Router + RSC) on Vercel for the dashboard and Server Actions, and Deno Edge Functions on Supabase for the AI agents (voice-worker, process-whatsapp) and webhooks. The runtime separation is physical — Node and Deno don't import each other — and we share logic by duplicating byte-by-byte under `supabase/functions/_shared/` with parity tests that fail on the slightest drift.

AI uses Groq (Llama 3.3-70B + 3.1-8B with key rotation) and optional Gemini as fallback chain. Embeddings with `gte-small` running inside Supabase Edge runtime. STT/TTS with Deepgram Nova-2/Aura-2. All on free tiers — the production stack costs $0/month.

Multi-tenant isolation is 3-layer: `.eq('business_id', X)` filters + ownership asserts in every repository, RLS in Postgres (`current_business_id()` from the JWT), and a semantic `ConstitutionalReviewer` reviewing the coherence of every AI write.

Payments with three gateways converging to `saas_invoices`: PayPal with async webhook + atomic `fn_finalize_paypal_payment` RPC with `FOR UPDATE` (atomic Postgres idempotency), NOWPayments crypto via QStash with back-pressure, and manual with admin approval. The referral system adds 30 days to the referrer when their referee closes the first `finished` payment.

Tests: 114 files between unit (Vitest), integration (against local Supabase), components (RTL) and E2E (Playwright). Adversarial tests against prompt injection and cross-tenant. Pre-push runs lint + tsc + vitest + npm audit; no `--no-verify`."

### Senior

"The project tackles two scale problems: LLM hallucinations in operations with side effects (booking), and data isolation in multi-tenant SaaS.

For hallucinations I implemented **10 verifiable mechanisms** combined: corpus mention guards (service/client/date/time must trace to the user), total fast-paths without LLM, deterministic date-guard, corpus frame-cutoff, per-turn fingerprint dedup, response bypass (`return_direct`), 2-turn confirmation gate that passes `tools=[]` to the model, embedded `<function>` recovery, semantic router with precomputed embeddings, and a fail-open constitutional reviewer with rubric versioned in code.

For isolation I combined 3 layers: filtered repositories + ownership asserts, RLS with `current_business_id()` derived from JWT, and the constitutional reviewer on AI writes detecting semantic `TENANT_MISMATCH`.

Noteworthy decisions I justify:
- Byte-by-byte duplication of `lib/ai/{memory,router,supervisor,training,observability}` under `supabase/functions/_shared/` with parity tests because Deno and Node can't cross-import and bundling was more expensive.
- Zero synthesis LLM calls in WhatsApp when the tool succeeded: using a deterministic template closes the `400→circuit-breaker→503` loop we suffered.
- `PAYPAL_ENV=live` explicit opt-in because Vercel sets `NODE_ENV=production` in previews — without opt-in every PR would charge real money.
- Fail-open in the reviewer because the structural layers (filtered repos + RLS) are sufficient and blocking legitimate bookings due to reviewer flakiness is worse than letting one anomalous edge case through.
- Episodic memory with TTL instead of eternal retention because the reviewer only needs recent context (10 min) to detect `DUPLICATE_INTENT`.

Observability: every turn generates an `ai_traces` row with latency, tokens, tool sequence (no args), outcome and query_hash (truncated SHA-256). A daily cron samples up to 500 traces per business, buckets them and exports them to `ai_training_exports` with `schema_version`. Zero PII guaranteed by types.

Idempotent payments with RPC `fn_finalize_paypal_payment` using `SELECT ... FOR UPDATE` — Postgres locks the second caller until the first commits, and the second sees `status='finished'` → returns `already_processed`. Atomic at DB level, no distributed claim or application locks.

Stack that fits in $0/month: Groq free + Gemini free + Deepgram $200 credits + Supabase free + Upstash free + Vercel free. End-to-end voice latency: 1.2-2.0s. WhatsApp with QStash retry ladder absorbs LLM rate-limits transparently to the client.

The suite covers 114 files: adversarial tests against prompt-injection, Node-Deno parity, fast-paths, RPC idempotency, RLS audit, Playwright E2E. Pre-push runs lint + tsc + vitest + npm audit."
