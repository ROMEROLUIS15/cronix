# Cronix — Comprehensive Technical Manual (EN)

> **Personal document of the author.** Listed in `.gitignore`.
> Exact mirror: `TECHNICAL_DOCUMENTATION_ES.md` (ES).
> Purpose: defend every decision of the project in Junior / Middle / Senior interviews.
> Every claim is verified against the actual repository code.

---

## Table of Contents

1. [The problem Cronix solves](#1-the-problem-cronix-solves)
2. [Business model and monetization](#2-business-model-and-monetization)
3. [Verified tech stack](#3-verified-tech-stack)
4. [Runtime architecture (Node + Deno)](#4-runtime-architecture-node--deno)
5. [Multi-tenant isolation — 5 layers](#5-multi-tenant-isolation--5-layers)
6. [AI system — models, costs, decisions](#6-ai-system--models-costs-decisions)
7. [The 10 anti-hallucination layers](#7-the-10-anti-hallucination-layers)
8. [BookingEngine — single source of truth](#8-bookingengine--single-source-of-truth)
9. [Voice Worker (Deno) — detailed pipeline](#9-voice-worker-deno--detailed-pipeline)
10. [Process WhatsApp (Deno) — detailed pipeline](#10-process-whatsapp-deno--detailed-pipeline)
11. [Vector episodic memory](#11-vector-episodic-memory)
12. [Observability and training-data pipeline](#12-observability-and-training-data-pipeline)
13. [Semantic router](#13-semantic-router)
14. [Constitutional Reviewer (supervisor)](#14-constitutional-reviewer-supervisor)
15. [Payment system — three gateways](#15-payment-system--three-gateways)
16. [Referral system](#16-referral-system)
17. [Roles, employees and permissions](#17-roles-employees-and-permissions)
18. [Rate limiting, circuit breaker and resilience](#18-rate-limiting-circuit-breaker-and-resilience)
19. [Notifications (in-app + push + WhatsApp)](#19-notifications-in-app--push--whatsapp)
20. [Internationalization (i18n)](#20-internationalization-i18n)
21. [PWA and service worker](#21-pwa-and-service-worker)
22. [Authentication, session and Passkeys](#22-authentication-session-and-passkeys)
23. [Frontend — App Router + RSC + state](#23-frontend--app-router--rsc--state)
24. [Database — schema and migrations](#24-database--schema-and-migrations)
25. [Test suite](#25-test-suite)
26. [Quality and CI/CD pipelines](#26-quality-and-cicd-pipelines)
27. [Deployment and operating costs](#27-deployment-and-operating-costs)
28. [Architectural decisions (interview FAQ)](#28-architectural-decisions-interview-faq)
29. [Defense script by level (Junior / Mid / Senior)](#29-defense-script-by-level)
30. [Glossary](#30-glossary)

---

## 1. The problem Cronix solves

Service businesses in LATAM (hair salons, barber shops, clinics, spas, nail studios, tattoo parlors, physiotherapists) face five compounded pain points:

1. **Manual WhatsApp handling** burns hours. The owner ends up replying at 11pm.
2. **Existing booking apps** (Booksy, Square, Mindbody) force the customer to download something and create an account — friction = lost customers.
3. **Existing chatbots hallucinate**: they book in occupied slots, confuse clients with similar names, repeat bookings if the user insists, ignore local timezone.
4. **Faulty multi-tenant isolation**: in typical B2B SaaS, a single `WHERE business_id = …` separates one business from another. A junior forgets it and data leaks cross-tenant.
5. **Payments in LATAM**: credit cards don't always reach the gateway (Venezuela blocked, prepaid plans), crypto requires education, manual transfers require humans.

**Cronix tackles all 5 simultaneously**:

- **WhatsApp 24/7**: a single Cronix Cloud number serves every business. The customer just clicks the business' link and types.
- **Voice in the dashboard**: the owner talks to the app ("book María tomorrow 3pm") and Cronix executes. Deepgram STT + TTS, end-to-end latency <2s.
- **10 verifiable anti-hallucination layers**: phantom types, fast-paths, date-guards, fingerprint dedup, constitutional reviewer, etc. (section 7).
- **5 isolation layers**: phantom-typed `TenantContext` → `TenantEnforcer.verify()` → filtered repos → Postgres RLS → semantic `ConstitutionalReviewer`.
- **3 gateways converging into one `saas_invoices` table**: PayPal (card + balance), NOWPayments (USDT BSC), Pago Móvil VE + Binance Pay (manual).

## 2. Business model and monetization

- **Free**: manual scheduling from the dashboard, no AI, no WhatsApp. Lets the owner try the tool.
- **Pro**: WhatsApp AI + voice assistant + push notifications + branding + referrals. Monthly subscription.
- **Enterprise** (upcoming): multi-location, consolidated reports, API.

Plan limits live in `lib/plans/plan-limits.ts` (single source of truth). Every UseCase that may exceed a limit consults this file, not the DB. Benefits:
1. If the owner downgrades, the limits change without a migration.
2. Deterministic tests — they don't depend on actual DB state.

### Referral system

Every `business` has a unique `referral_code` generated at registration. When a new business registers with `?ref=<code>`, its `referred_by_id` is stored. Upon closing their **first** `finished` payment, `applyReferralBonus()` adds 30 days to the referrer's `subscription_ends_at` (only if the referrer has plan ≠ free).

Verifiable in `lib/payments/subscription-fulfillment.ts:7-53`.

## 3. Verified tech stack

### Runtime A — Node.js (Vercel)

- **Next.js 15** with App Router + Server Components + Server Actions + Turbopack.
- **React 19**.
- **TypeScript 5** with `noUncheckedIndexedAccess`.
- **Tailwind CSS 3** + **Framer Motion** + **lucide-react** + `shadcn`-style components.
- **TanStack Query 5** for cached server-state.
- **React Hook Form 7** + **Zod 3** for forms + runtime validation.
- **next-intl 4** with 6 locales (es/en/fr/de/it/pt).
- **@supabase/ssr** for server-side session and secure cookies.
- **@upstash/redis** + **@upstash/qstash** for cache and queues.
- **@sentry/nextjs** for errors + breadcrumbs.
- **@simplewebauthn/server** and `/browser` for Passkeys.
- **@paypal/react-paypal-js** for the PayPal button.
- **@ducanh2912/next-pwa** (custom service worker).

### Runtime B — Deno (Supabase Edge Functions)

- `serve` from `https://deno.land/std@0.168.0/http/server.ts`.
- `createClient` from `https://esm.sh/@supabase/supabase-js@2.39.7`.
- `Deno.env` access for secrets.
- `Supabase.ai.Session('gte-small')` for embeddings inside the edge itself.
- **No** imports from `@/lib/...` Next.js allowed. To share logic with Node, code is duplicated byte-by-byte under `supabase/functions/_shared/` with parity tests.

### Data

- **PostgreSQL 15** with **RLS** enabled on every table containing `business_id`.
- **pgvector** for 384-dim embeddings.
- **pg_cron** for daily tasks (expirations, training-data export, expired memory purge).
- Supabase **Realtime** for `appointments` and `notifications`.
- Supabase **Storage** for logos (`logos` bucket with RLS policies).

### Cache and queues

- **Upstash Redis**: conversational session (voice-worker `core/session.ts`), rate-limits, daily token counters.
- **Upstash QStash**: NOWPayments webhook → queue → worker `/api/queue/process-saas-payment`. Automatic retries with `Retry-After` ladder.

### AI

| Layer | Service | Plan |
|---|---|---|
| Primary LLM | Groq `llama-3.3-70b-versatile` | Free tier |
| Fallback LLM | Groq `llama-3.1-8b-instant` | Free tier |
| Optional alt LLM | Gemini `gemini-2.0-flash` (OpenAI-compat) | Free tier |
| Reviewer | Groq `llama-3.1-8b-instant` @T=0 | Free tier |
| Embeddings | `gte-small` (384 dim) via `Supabase.ai.Session` | No extra cost |
| STT | Deepgram `nova-2` | Free tier ($200 credits) |
| TTS | Deepgram `aura-2-nestor-es` | Same credits |
| Cerebras (optional Node-side) | endpoint `api.cerebras.ai` | Free tier |

### Observability

- **Sentry** for frontend + Server Actions + Edge Functions.
- **Axiom** for structured logs.
- **`ai_traces`** — our own table for every conversational turn.
- **`ai_training_exports`** — daily versioned datasets.
- **Vercel Logs** for hot path.

### Testing

- **Vitest 3** (unit + components + integration).
- **Playwright** (E2E).
- **React Testing Library** + **MSW** for HTTP mocking.
- **vitest-mock-extended** for typed mocks.

## 4. Runtime architecture (Node + Deno)

```
┌─────────────────────────────────────┐        ┌─────────────────────────────────────┐
│ RUNTIME A — Node.js (Vercel)        │        │ RUNTIME B — Deno (Supabase Edge)    │
│                                     │        │                                     │
│ app/                                │        │ supabase/functions/                 │
│ ├─ [locale]/dashboard/              │        │ ├─ voice-worker/                    │
│ ├─ api/webhooks/{paypal,nowpay}/    │        │ ├─ process-whatsapp/                │
│ ├─ api/queue/process-saas-payment/  │        │ ├─ whatsapp-webhook/                │
│ ├─ api/cron/check-subscriptions/    │        │ ├─ whatsapp-service/                │
│ ├─ api/assistant/{proactive,tts}/   │        │ ├─ cron-reminders/                  │
│ ├─ api/passkey/*                    │        │ ├─ push-notify/                     │
│ └─ api/admin/*                      │        │ ├─ embed-text/                      │
│                                     │        │ └─ export-ai-traces/                │
│ lib/                                │        │                                     │
│ ├─ ai/ (core+memory+router+...)     │ ◄────► │ supabase/functions/_shared/         │
│ ├─ domain/ (use-cases+repos)        │  byte- │ (duplicate of lib/ai/* with .ts ext │
│ ├─ repositories/                    │  copy  │  in imports — parity-tested)        │
│ ├─ payments/                        │        │                                     │
│ ├─ referrals/                       │        │                                     │
│ ├─ plans/                           │        │                                     │
│ ├─ supabase/ (SSR + admin clients)  │        │                                     │
│ ├─ rate-limit/                      │        │                                     │
│ ├─ security/                        │        │                                     │
│ ├─ auth/                            │        │                                     │
│ └─ i18n/                            │        │                                     │
└─────────────────────────────────────┘        └─────────────────────────────────────┘
                  │                                                │
                  └──────────────── Supabase DB ───────────────────┘
                                Postgres 15 + RLS + pgvector
```

**Golden rule**: no Node file can be imported from Deno and vice versa. The dividing line is physical. This forces:
1. Shared code to be explicitly shared (visible duplication).
2. A change on one side cannot silently break the other.
3. Each runtime uses its idiomatic dependencies (Edge uses `esm.sh`, Node uses `@supabase/ssr`).

**How logic is shared**: `supabase/functions/_shared/` duplicates byte-by-byte the modules under `lib/ai/{memory,router,supervisor,training,observability}/`. Parity tests in `__tests__/ai/*/parity.test.ts` fail on the smallest drift. See `docs/architecture/internals/SHARED_PARITY.md` for detail.

## 5. Multi-tenant isolation — 5 layers

### Layer 1 — Phantom-typed `TenantContext` (compile-time)

`lib/ai/core/security/TenantEnforcer.ts:25-32`:

```ts
declare const __tenantBrand: unique symbol

export type TenantContext = {
  readonly businessId: string
  readonly userId:     string
  readonly timezone:   string
  readonly [__tenantBrand]: true
}
```

`__tenantBrand` doesn't exist at runtime — it's erased by the transpiler. But at compile-time, TypeScript blocks any attempt to do `const ctx: TenantContext = {...}` directly. The only place that does `as TenantContext` is `TenantEnforcer.verify()`. Any other attempt **does not compile**.

### Layer 2 — `TenantEnforcer.verify()` (runtime DB check)

```ts
const ctx = await TenantEnforcer.verify(requestedBusinessId, authUserId, timezone)
// Reads users.business_id; if !== requestedBusinessId → throws UNAUTHORIZED
```

For external channels (WA webhooks) there is `TenantEnforcer.verifyWebhook(businessId, timezone)` that only checks the business exists. Intentionally different because WA has no authenticated user.

### Layer 3 — Filtered repositories + ownership asserts

Every repository (`lib/repositories/Supabase*Repository.ts`) includes `.eq('business_id', businessId)` in **every** query. For mutations, an explicit assert is also done:

```ts
// SupabaseAppointmentRepository.updateStatus
if (apt.business_id !== businessId) throw new Error('Ownership mismatch')
```

Verifies that the read row actually belongs to the tenant before updating — protects against the paranoid case where RLS gets accidentally disabled.

### Layer 4 — Row Level Security in Postgres

Every table with `business_id` has policy `USING (business_id = current_business_id())`. The function `current_business_id()` reads from the JWT (`auth.uid()` → `users.business_id`). Relevant migrations:
- `20260414000000_rls_current_business_id.sql`
- `20260413000000_fix_users_rls_tenant_isolation.sql`
- `20260418100000_fix_appointment_services_rls.sql`

Even if `service_role` got compromised, RLS blocks client traffic. `service_role` bypasses RLS but is **only** used from authenticated server-side code. Never exposed to the browser.

### Layer 5 — Constitutional Reviewer (semantic)

On every supervised write (`confirm_booking`, `cancel_booking`, `reschedule_booking`), a reviewer LLM emits `allow | block | warn`. Detects semantic incoherence that technical layers don't catch: ambiguous client, double-intent, contradiction with memory. Detail in `docs/architecture/internals/SUPERVISOR.md`.

### How an attacker would fail

- Compile-time bypass → impossible (phantom type).
- Forging JWT → impossible if Supabase Auth is intact.
- Modifying `business_id` in the payload → `TenantEnforcer.verify` rejects.
- Skipping the repo and using `.from(...)` directly → RLS blocks.
- Compromising service-role key → RLS still applies, but the attacker would read everything if calling with `service_role`. **That's why the key is only server-side**, never in `NEXT_PUBLIC_*`.

## 6. AI system — models, costs, decisions

### Production models (verified)

| Layer | Actual model | File |
|---|---|---|
| Primary voice LLM | `llama-3.3-70b-versatile` | `voice-worker/providers/GroqProvider.ts:36` |
| Voice fallback | `llama-3.1-8b-instant` | same file:37 |
| Alt chain | `gemini-2.0-flash` (OpenAI-compat) | `voice-worker/providers/GeminiProvider.ts:32` |
| WhatsApp ReAct decider | `llama-3.1-8b-instant` (SMALL_MODEL) | `process-whatsapp/groq-client.ts` |
| WA final synthesis | `llama-3.3-70b-versatile` (skipped via template) | `process-whatsapp/ai-agent.ts:411` |
| Reviewer | `llama-3.1-8b-instant` @T=0 + json_object | `lib/ai/supervisor/GroqReviewerLlm.ts:11` |
| Embeddings | `gte-small` 384 dim | `supabase/functions/embed-text/index.ts:4` |
| STT | Deepgram Nova-2 ES | `voice-worker/stt.ts`, `process-whatsapp/ai-agent.ts:519` |
| TTS | Deepgram Aura-2 `aura-2-nestor-es` | `voice-worker/tts.ts`, `app/api/assistant/proactive/route.ts:34` |
| Cerebras (optional Node) | Cerebras endpoint | `lib/ai/providers/groq-provider.ts:25` |

### Why Groq

- **Robust free tier**: covers MVP traffic.
- **OpenAI tool-calling format**: zero translation to integrate Llama 3.x.
- **Key rotation 429**: `LLM_API_KEY` accepts CSV. If a key hits rate-limit, the next is tried. Lets us saturate free plans gradually.
- **Ultra-low latency**: the Groq cluster is famously fast (>300 tokens/s on 70B).

### Why optional Gemini

- Provider diversification. If Groq dies globally, `LLM_PROVIDER=gemini,groq` keeps service up.
- OpenAI-compat endpoint (`v1beta/openai/chat/completions`) → zero translation.
- Free tier separate from Groq.

### Why Deepgram

- **Nova-2 Spanish** accepts `keywords[]` to bias recognition toward the business' real names. Verifiable at `voice-worker/index.ts:267-275`:

```ts
const [transcript, [ctx, sessionResult]] = await Promise.all([
  getClientFirstNamesForBoost(supabase, userCtx.businessId)
    .catch(() => [] as string[])
    .then(keywords => transcribe(audio, { keywords })),
  Promise.all([
    loadBusinessContext(supabase, userCtx.businessId, timezone),
    loadSession(userCtx.userId, clientHistory),
  ]),
])
```

Active client names are passed as `keywords` to STT — this solves the typical STT mangling cases (Lizvet ↔ Lisbeth, Gardi → Gardi Suárez). **Zero extra cost**, much better accuracy.

- **Aura-2 `nestor-es`**: neutral Spanish male voice, <500ms latency.

### Real operating cost

| Service | Plan | Enough for |
|---|---|---|
| Groq | Free tier | ~50K requests/day with key rotation |
| Gemini | Free tier | Backup |
| Deepgram | $200 initial credits | Thousands of minutes |
| Supabase | Free | 500MB DB + 2GB storage + Edge functions |
| Upstash Redis | Free | 10K cmd/day |
| Upstash QStash | Free | 500 msgs/day |
| Vercel | Free hobby | Enough for MVP |
| Sentry | Free dev | 5K errors/month |
| **Total** | **$0/month** | **The whole MVP running** |

As traffic grows, the first costs will be Deepgram (STT volume) and Supabase (storage). The stack scales linearly without re-architecture.

## 7. The 10 anti-hallucination layers

Each layer has its file, verifiable lines and associated test:

### 7.1 Phantom-typed `TenantContext` (compile-time)

`lib/ai/core/security/TenantEnforcer.ts:25-32`. Already covered in §5.1.

### 7.2 Total fast-paths without LLM

`supabase/functions/voice-worker/capabilities/_shared/registry.ts`. Every capability has a regex/heuristic detector. If it fires, the tool runs directly bypassing the LLM. 9 capabilities documented in `docs/architecture/internals/VOICE_CAPABILITY_REGISTRY.md`.

Example (`capabilities/list-appointments/fast-path.ts`): detects "qué tengo mañana", "agenda de hoy", "qué citas tengo el sábado" → runs `get_appointments_by_date` directly with the date resolved deterministically.

### 7.3 Deterministic date guard

`voice-worker/agent.ts:104-115`. If the user said "hoy / mañana / pasado mañana", `detectTemporalIntent` returns `{date, reason}`. When the LLM emits a tool with a different `date`, it gets overridden:

```ts
if (dateOverride && DATE_TOOLS.has(tc.name) && typeof parsedArgs.date === 'string') {
  const llmDate = parsedArgs.date as string
  if (llmDate !== dateOverride.date) {
    console.warn(`Date guard: user said ${dateOverride.reason} but LLM passed ${llmDate} → overriding to ${dateOverride.date}`)
    parsedArgs.date = dateOverride.date
  }
}
```

Order matters: `pasado mañana` is checked **before** `mañana` (the latter is a substring of the former).

### 7.4 Corpus frame-cutoff

`voice-worker/index.ts:329-340`. The text corpus passed to guards (date-guard, fuzzy-guard) is built from the last non-question assistant turn. This prevents tokens from a failed previous attempt ("sábado 5pm") from contaminating an unrelated new attempt:

```ts
let cutoff = -1
for (let i = history.length - 1; i >= 0; i--) {
  const msg = history[i]
  if (msg && msg.role === 'assistant' && !/[?¿]/.test(msg.content)) {
    cutoff = i
    break
  }
}
const relevantHistory = history.slice(cutoff + 1)
```

Rules:
- "Listo. Agendé a María..." → closes the frame.
- "¿Para qué servicio?" → keeps the frame open (multi-turn collection).
- "No encontré cita activa..." → closes the frame.

### 7.5 Per-turn fingerprint dedup

`voice-worker/agent.ts:336-351` and `process-whatsapp/ai-agent.ts:322-334`. Before executing a tool, `{toolName + sortedArgsJSON}` is canonicalized and checked against a `Set<string>`. If already executed this turn with the same args, it's blocked with a message to the model:

```
This action has already been executed in this turn with the same data.
DO NOT repeat it. Synthesize the previous result and finish.
```

Prevents double bookings if Llama 3.x loops on tool-result mishandling.

### 7.6 Response bypass (`bypassLLM`)

`voice-worker/agent.ts:410-418` and `capabilities/_shared/registry.ts`. If the only tool executed this turn has `bypassLLM=true` and returned user-facing prose, it's returned directly without going through the synthesis LLM:

```ts
if (resp.toolCalls.length === 1 && lastResultText && BYPASS_CAPABILITIES.has(resp.toolCalls[0].name)) {
  finalText = lastResultText
  break
}
```

Standard pattern — equivalent to LangChain's `return_direct=True`.

### 7.7 2-turn confirmation gate (WhatsApp)

`process-whatsapp/confirmation-gate.ts`. Write tools are only callable when:
1. The assistant's last reply ends in a confirmation question.
2. The user's last message is affirmative per the semantic router (intent `affirmation`).

When the gate is closed, **the tools array is passed empty to the LLM** → the model doesn't see the schemas → cannot hallucinate them. Stronger than output sanitization.

### 7.8 Embedded `<function>` recovery (WhatsApp)

`process-whatsapp/ai-agent.ts:270-301`. The 8B sometimes emits plain text `<function=confirm_booking>{...}</function>`. If the gate was open and the JSON parses and `fnName ∈ {confirm_booking, reschedule_booking, cancel_booking}`, it's promoted to a real `tool_calls[]`. Any other pattern is ignored and `INTERNAL_SYNTAX_FALLBACK` is returned.

### 7.9 Semantic router

`lib/ai/router/SemanticRouter.ts`. 9 canonical intents with precomputed embeddings. At runtime, a single embedder call + cosine similarity → deterministic routing. Threshold 0.78. Detail in `docs/architecture/internals/SEMANTIC_ROUTER.md`.

### 7.10 Constitutional reviewer

`lib/ai/supervisor/`. Reviewer LLM emits `allow | block | warn` with codes. Fail-open. Detail in `docs/architecture/internals/SUPERVISOR.md`.

## 8. BookingEngine — single source of truth

`lib/ai/core/booking/BookingEngine.ts`.

### Invariants (verbatim from the file comment)

1. Only accepts `TenantContext` — tenant verification is structural.
2. Validates with Zod BEFORE any DB operation.
3. Converts timezone once, at the correct layer (before writing).
4. Never throws — every error is a `ToolResult`.
5. Invalidates cache after every successful write.

### Public API

```ts
class BookingEngine {
  constructor(repos: BookingEngineRepos, onBeforeDispatch?: OnBeforeDispatchHook)

  async createAppointment(ctx, rawArgs, opts?):    Promise<ToolResult<BookingData>>
  async cancelAppointment(ctx, rawArgs):           Promise<ToolResult<BookingData>>
  async rescheduleAppointment(ctx, rawArgs):       Promise<ToolResult<BookingData>>
  async getAppointmentsByDate(ctx, rawArgs):       Promise<ToolResult<void>>
  async getAvailableSlots(ctx, rawArgs, wh?):      Promise<ToolResult<void>>
  async createClient(ctx, rawArgs):                Promise<ToolResult<{id, name}>>
  async searchClients(ctx, rawArgs):               Promise<ToolResult<void>>

  async dispatch(ctx, toolName, rawArgs, opts?):   Promise<ToolResult<unknown>>
}
```

### `createAppointment` flow (detailed)

1. **Zod safeParse** of the payload → `INVALID_ARGS` on failure.
2. **`ClientResolver.resolve`**:
   - If `client_id` provided → UUID lookup.
   - If `client_name` provided → fuzzy match against the active roster (`findActiveForAI`).
   - Multiple matches → returns `ambiguous` with candidates.
   - None → if `autoCreateClient` (default true), creates via `CreateClientUseCase`.
3. **`ServiceResolver.resolve`**:
   - Exact UUID → direct.
   - Name → fuzzy + ambig handling.
4. **`localToUTC(date, time, ctx.timezone)`** → UTC ISO.
5. **`CreateAppointmentUseCase.execute`** atomic:
   - Conflict check vs `findConflicts(businessId, startISO, endISO, excludeId?)`.
   - INSERT into `appointments` + `appointment_services` (M2M).
6. **`cache.invalidate(businessId, 'appointments' | 'dashboard')`** — forces dashboard re-fetch.
7. **`toolOk(data, prose)`** with user-facing message.

### Why resolve client/service inside the engine

Previously each channel (dashboard, WhatsApp) had its own matching logic. Result: the dashboard accepted "María" but WhatsApp required "María Pérez full name". Centralizing matching eliminates that bias and allows a single set of adversarial tests (`ClientResolver.test.ts`, `ServiceResolver.test.ts`).

### `onBeforeDispatch` hook

Detail in `docs/architecture/internals/BOOKING_ENGINE_HOOK.md`. Fires only for `{confirm_booking, cancel_booking, reschedule_booking}`. The call-site (voice or WA) builds a closure that already captured the turn's `userUtterance` and `recentMemory`.

## 9. Voice Worker (Deno) — detailed pipeline

`supabase/functions/voice-worker/index.ts`.

### Steps

1. **CORS preflight** OPTIONS → 204.
2. **POST validation** — Authorization header required.
3. **`resolveUserAndBusiness(auth)`** — `auth.getUser(jwt)` + `users.business_id` lookup.
4. **Rate-limit 30/min per user** via Redis (`redis.ts:checkRateLimit`).
5. **Parse payload**:
   - Multipart with `audio` + `timezone` + `history?` → Deepgram STT with keyword boost.
   - JSON `{text, timezone, history?}` (Web Speech API on desktop) → direct.
6. **Parallel load**:
   - `transcribe(audio, {keywords})` (Deepgram Nova-2).
   - `loadBusinessContext(businessId, tz)` (services, clients, today's appointments, working hours, aiRules).
   - `loadSession(userId, clientHistory)` (Redis with fallback to sanitized client history).
   - `getClientFirstNamesForBoost(businessId)` (names injected into Deepgram).
7. **Corpus frame-cutoff**.
8. **Constitutional guard**: pre-recall memory + closure injected into `ctx.runWriteGuard`.
9. **Registry fast-paths**: if it fires, runs directly and returns.
10. **LLM loop** (MAX_STEPS=3):
    - Provider chat (Groq 70B → 8B fallback, optional Gemini in chain).
    - Date-guard on tools with `date` arg.
    - Per-turn fingerprint dedup.
    - Execute tool → record result.
    - If `bypassLLM` and the only tool of the turn → cut and return prose.
11. **Parallel persistence**: `saveSession` + `dispatchBellNotification[]`.
12. **Deepgram Aura-2 TTS** synchronous.
13. **Response**: `{text, audioUrl, actionPerformed, transcription, modelUsed}`.

### `LastReferencedAppointment` and anaphora

When a write tool succeeds, `lastRefCandidate` updates with `{appointmentId, clientName, serviceName, date, time}`. The session saves with that ref. In the next turn, fast-path detectors (cancel, reschedule) use it to resolve "cancélala" / "reagéndala" without re-naming the client.

If the action was `cancelled`, `lastRefCandidate = null` (the appointment is gone — anaphora would be nonsense).

`pruneStaleRef` (inside `core/session.ts`) discards refs >10 min old.

### Why three providers (Groq + optional Gemini + Cerebras)

Free-tier diversification and resilience. `FallbackChain` (`providers/registry.ts`) tries providers in order and only propagates the last error. Detail in `docs/architecture/internals/PROVIDER_FALLBACK.md`.

## 10. Process WhatsApp (Deno) — detailed pipeline

`supabase/functions/process-whatsapp/message-handler.ts` + `ai-agent.ts`.

### Pipeline

1. **`whatsapp-webhook`** receives Meta POST → verifies HMAC `x-hub-signature-256` → publishes to QStash.
2. **`process-whatsapp`** dequeues:
   - **Layer 1**: `verifyQStash(req, rawBody)`.
   - Audio → Deepgram Nova-2 STT.
   - **Layer 2**: phone rate-limit (10/60s) via RPC `fn_wa_check_rate_limit`.
   - Slug extraction `#slug` BEFORE sanitize (the `#` would otherwise be stripped).
   - **Sanitize anti prompt-injection**.
   - **3-tier routing**: slug → Redis session → landing fallback.
   - **`VINCULAR-{slug}`** intercept for owner verification.
   - **Layer 3**: business usage quota (50/60s).
   - **Layer 4**: daily token quota.
   - Parallel load: `getBusinessServices`, `getClientByPhone`, `getActiveAppointments`, `getConversationHistory(6)`, `getBookedSlots`.
   - `memoryEngine.recall` + `router.classify` in parallel.
   - `tracer.start` (open ai_traces handle).
   - **SMALL_MODEL ReAct loop** (MAX_STEPS=3):
     - `toolsAllowedThisTurn` decides whether write tools are active.
     - `BOOKING_TOOLS` or `[]` passed to the LLM.
     - Embedded `<function>` recovery if the model emits syntax leaks.
     - Fingerprint dedup.
     - `executeToolCall` → `BookingEngine.dispatch` (with `onBeforeDispatch = writeGuard`).
   - **End decision tree**:
     - Last tool success → `renderBookingSuccessTemplate` (skip LARGE_MODEL).
     - Last tool failed with known errorCode → deterministic message per code.
     - No tool, no text → fallback clarification.
     - 8B text present → use direct.
   - **`sanitizeOutput`** + `containsInternalSyntax` check.
   - `memoryEngine.write` fire-and-forget (TTL 180d).
   - `sendWhatsAppMessage` (with retry).
   - `logInteraction` + `trace.finish(outcome, errorCode, finalTextSha)`.

### Retry ladder

- `LlmRateLimitError` or `CircuitBreakerError` → `return retryLater(retryAfterSecs)` → 503 + Retry-After. QStash waits and retries. The WhatsApp client gets the answer once the backend unblocks.
- Other errors → 202 + DLQ log. Prevents QStash from infinite-looping on fatal bugs.

### Confirmation gate

`confirmation-gate.ts:toolsAllowedThisTurn(history, userText)`:
- Finds the last assistant question.
- If NOT ending in `?` → gate closed.
- If ending in `?` → checks the last user message:
  - intent `affirmation` (via router) → gate open.
  - anything else → gate closed.

When the gate is closed, `activeTools = []`. The model only talks.

### Why cutting the second LLM call on success

Historical: when the tool succeeded and the result was passed to the LARGE_MODEL (70B) for empathic synthesis, the 70B sometimes responded with 400 (rate-limit) → circuit-breaker opened → 503 → client without reply. The solution: use `renderBookingSuccessTemplate` directly. Loses some "warmth" in the reply but gains absolute reliability.

## 11. Vector episodic memory

Full detail in `docs/architecture/internals/MEMORY.md`. Summary:

- Table `ai_memories_v2` (migration `20260518000000`).
- 384-dim embeddings via `gte-small`.
- RPC `match_ai_memories_v2` applies tenant filter BEFORE vector scan.
- `MemoryEngine.recall(scope, query, {topK, threshold})` returns sorted hits.
- `MemoryEngine.write(scope, {kind, content, metadata, ttlDays})` fire-and-forget.
- Recall mandatory before reviewer — `reviewWriteOrFailOpen` throws `TypeError` if `recentMemory` is not an array.

### Use cases

- WhatsApp: after success, persists `Cliente {nombre}: {tool} — {userText}`. The next turn from the same client recalls that context and the reviewer can detect duplicate intent (same client booking the same thing in <10 min).
- Voice (dashboard): persists owner decisions ("agendé a María Pérez Mon 15h") → next turn enables anaphora.

## 12. Observability and training-data pipeline

Detail in `docs/architecture/internals/OBSERVABILITY.md` and `docs/architecture/internals/TRAINING_PIPELINE.md`.

### `ai_traces`

Every turn = 1 row with:
- `business_id`, `channel`, `actor_kind`, `actor_key`.
- `query_hash` (SHA-256 truncated input — NOT the text).
- `outcome ∈ {success, failure, error, rate_limited, no_action}`.
- `error_code`, `final_text_sha`, `latency_ms`, `total_tokens`, `steps_count`, `tools_count`.
- `llm_steps[]` with model, latency, tokens, hadToolCalls.
- `tool_calls[]` with tool, duration, status, argsFingerprint (hash), errorCode.
- `metadata` with `memory_hits`, `intent`, `intent_confidence`.

### `ai_training_exports` (daily cron)

Pipeline in `supabase/functions/export-ai-traces/index.ts`:

1. Cron 03:00 UTC (via pg_cron + `https_call`).
2. For each `business_id`, samples up to 500 traces from the last 24h (RPC `ai_traces_sample_window`).
3. Transforms to `TrainingSample` (no PII):
   - `latency_bucket: fast | normal | slow | critical`
   - `tokens_bucket: low | medium | high | extreme`
   - `outcome`, `error_code`, `tool_sequence` (names only), `intent`, counts.
4. INSERT into `ai_training_exports` with `schema_version`.

**Zero-PII guaranteed by type**: the `rowToSample` function only reads structural fields. TypeScript prevents access to others.

Buckets live in `lib/ai/training/TrainingExporter.ts` (not in DB). Changing thresholds requires no migration.

## 13. Semantic router

Detail in `docs/architecture/internals/SEMANTIC_ROUTER.md`.

9 intents: `book_appointment`, `cancel_appointment`, `reschedule_appointment`, `check_availability`, `pricing_inquiry`, `list_appointments`, `greeting`, `affirmation`, `negation`.

### Why precomputed embeddings

- Offline `npm run seed:intents` runs `scripts/seed-intent-embeddings.ts` which for each `IntentDefinition.examples[]` calls the embedder and persists the JSON.
- Runtime: a single embedder call per turn + cosine vs N prototypes (N=9*examples=45 vectors). In microseconds.
- Versioning: the JSON is committed. Any change to `intents.ts` requires re-running the seed and committing the resulting JSON.

### Runtime usage

- **`process-whatsapp/ai-agent.ts:167`** — `router.classify(userText)` parallel to `memoryEngine.recall`. Result `{intent, confidence}` is injected into the system prompt + saved to trace metadata.
- **`confirmation-gate.ts`** — `affirmation` classification decides whether to open the gate.

## 14. Constitutional Reviewer (supervisor)

Detail in `docs/architecture/internals/SUPERVISOR.md`.

- Model: Groq `llama-3.1-8b-instant`, `temperature=0`, `response_format={type:'json_object'}`.
- Timeout 1500ms. Fail-open on timeout, network error, parse fail.
- Rubric v1 (versioned in code): 6 codes (`TENANT_MISMATCH`, `DUPLICATE_INTENT`, `CONTRADICTS_MEMORY`, `POLICY_VIOLATION`, `AMBIGUOUS_TARGET`, `UNSAFE_ARGS`).
- Hard rules: explicit utterance overrides any "suspicion by empty memory"; reviewer does NOT validate RLS/SQL/slot conflicts.

### Injection into BookingEngine

```ts
const ctx = {
  ...ctxBase,
  runWriteGuard: async (toolName, args) => {
    const outcome = await reviewWriteOrFailOpen({
      reviewer, toolName, args,
      scope:         { businessId, channel: 'voice' | 'whatsapp' },
      userUtterance: userText,
      recentMemory:  recalled.map(r => ({ content, similarity, createdAt })),
    })
    return outcome.allowed ? null : { /* failure result */ }
  },
}
```

BookingEngine invokes the hook **only** for tools in `REVIEWED_WRITE_TOOLS`. Reads go through directly.

## 15. Payment system — three gateways

Detail in `docs/architecture/PAYMENTS.md` and `docs/architecture/internals/PAYPAL_RPC_DESIGN.md`.

### Convergence in `saas_invoices`

```sql
CREATE TABLE saas_invoices (
  id              uuid PRIMARY KEY,
  business_id     uuid REFERENCES businesses(id),
  plan_purchased  text,
  amount_usd      numeric,
  status          saas_invoice_status,
  payment_provider text,
  paypal_order_id text UNIQUE,
  np_invoice_id   text UNIQUE,
  np_payment_id   text,
  crypto_amount   numeric,
  crypto_currency text,
  created_at      timestamptz,
  updated_at      timestamptz
);
```

### PayPal — dual frontend + webhook

```
1. Server action createPaypalOrder → POST /v2/checkout/orders → stores paypal_order_id in saas_invoices
2. User approves in popup
3.A Frontend onApprove → capturePayPalOrderAction → finalizePayPalPayment(orderId, amount)
3.B PayPal webhook PAYMENT.CAPTURE.COMPLETED → /api/webhooks/paypal
   ├─ verifyWebhookSignature (official PayPal API /v1/notifications/verify-webhook-signature)
   └─ finalizePayPalPayment(orderId, amount)
4. RPC fn_finalize_paypal_payment (FOR UPDATE):
   - Lock row
   - status=finished? → already_processed
   - amount mismatch? → amount_mismatch
   - else → status=finished + business.plan = plan_purchased + subscription_ends_at additive
5. Post-RPC (in Node):
   - notifications.insert('Payment confirmed!')
   - applyReferralBonus
```

**Atomic Postgres idempotency**: if both callers (frontend + webhook) arrive simultaneously, the first locks, the second waits and sees `status=finished` → returns `already_processed`. No application code needed.

**Amount validation**: if the frontend lied about the amount, the RPC compares against `saas_invoices.amount_usd` (recorded at order creation, before the user flow). $0.01 tolerance for float.

**Opt-in `PAYPAL_ENV=live`**: because Vercel injects `NODE_ENV=production` in previews. If we trusted `NODE_ENV`, every PR would charge real money.

### NOWPayments (crypto)

```
1. Server action createSaaSCheckoutSession → POST nowpayments.io/v1/invoice → np_invoice_id
2. saas_invoices.insert(status='waiting', np_invoice_id, payment_provider='nowpayments')
3. User pays on NOWPayments hosted page (USDT BSC or others)
4. NOWPayments IPN webhook → /api/webhooks/nowpayments
   ├─ verify HMAC with NOWPAYMENTS_IPN_SECRET
   └─ Publish to QStash (back-pressure)
5. QStash dequeue → /api/queue/process-saas-payment
   ├─ verifySignatureAppRouter (QSTASH_CURRENT_SIGNING_KEY / NEXT_SIGNING_KEY)
   ├─ toInvoiceStatus(payment_status) → unified enum
   ├─ Update saas_invoices
   ├─ If 'finished' → update businesses.plan + additive + notification + applyReferralBonus
   └─ If 'partially_paid' → warning notification
```

**Why QStash instead of inline processing**: the NOWPayments webhook must respond quickly. If we processed inline and the transaction is slow (5-30s), NOWPayments retries → potential duplication. QStash returns 200 OK immediately and the heavy processing goes serialized in a queue with dedup.

### Manual (Pago Móvil VE + Binance Pay)

`/dashboard/admin/payments` accessible only to `role === 'platform_admin'`. The owner submits a receipt via form → row in `manual_payments` → admin approves/rejects → if approved, triggers the same activation flow. BCV rate (Central Bank of Venezuela) + 30% markup in `lib/payments/bcv-rate.ts`.

### Additive `computeNextSubscriptionEnd`

```ts
function computeNextSubscriptionEnd(currentEndsAt, daysToAdd=30) {
  const now = new Date()
  const currentEnd = currentEndsAt ? new Date(currentEndsAt) : now
  const baseDate = currentEnd > now ? currentEnd : now
  baseDate.setDate(baseDate.getDate() + daysToAdd)
  return baseDate.toISOString()
}
```

Early renewal adds to the current end — loyalty reward, not penalty.

### Expiration cron

`/api/cron/check-subscriptions` (daily). For every `businesses.subscription_ends_at < now` and `plan ≠ free`:
1. Downgrade to free.
2. Notification with renewal CTA.

## 16. Referral system

`lib/referrals/rewards.ts` + `applyReferralBonus` in `subscription-fulfillment.ts`.

### Flow

```
1. Each business.referral_code is generated at registration (SQL trigger).
2. Public landing /[locale]/invite/[code] shows the offer and CTA.
3. /[locale]/register/ captures ?ref=<code> from the URL, persists in sessionStorage.
4. On business creation, businesses.referred_by_id = (lookup by referral_code).
5. When the referee closes their FIRST 'finished' saas_invoice:
   - count(*) FROM saas_invoices WHERE business_id=referee AND status='finished' = 1
   - Lookup referrer
   - Validate referrer.plan ≠ free
   - subscription_ends_at += REFERRAL_BONUS_DAYS (30)
   - notification 'success': "Month earned!"
```

### Why `count === 1`

If it fired on every payment, the referrer would get +30 days forever. The "only the first payment" rule turns the referee into a real customer (not just a sign-up).

## 17. Roles, employees and permissions

`users` table:
```sql
id            uuid PRIMARY KEY REFERENCES auth.users(id),
business_id   uuid REFERENCES businesses(id),
name          text,
role          text CHECK (role IN ('owner','employee','platform_admin')),
status        text,
phone         text,
created_at    timestamptz
```

### Roles

| Role | Capabilities |
|---|---|
| `owner` | Creates/edits business, manages employees, sees finances, pays subscription, full dashboard access. |
| `employee` | Handles appointments, marks completed, sees business agenda, does NOT see finances or billing. |
| `platform_admin` | Cronix internal support. Sees `/dashboard/admin/payments`. Manually assigned only. |

### Multi-employee

- Owner invites employees from `/dashboard/settings/team` (server action `inviteEmployee`).
- Magic-link email to `/auth/callback` that creates the `users` row with `business_id` already set and `role='employee'`.
- `appointments` rows have an optional `assigned_user_id` → allows assigning specific staff.
- `GetAvailableSlotsUseCase` can receive `staffId` and filter slots by employee schedule.

### Protective migration `protect_admin_role_trigger`

Migration `20260504000000_fix_protect_admin_role_trigger.sql` adds a trigger preventing a client/RLS request from setting `role='platform_admin'` except from service_role.

## 18. Rate limiting, circuit breaker and resilience

### Layered rate limits

| Layer | Scope | Implementation | Default |
|---|---|---|---|
| WA phone | sender → 60s | RPC `fn_wa_check_rate_limit` (Postgres sliding window) | 10/60s |
| WA business | business → 60s | similar RPC | 50/60s |
| WA token | business → day | `wa_token_usage` counter | 300K tokens/day |
| WA booking | sender → 24h | RPC `fn_book_appointment_wa` (idempotent) | 2/24h |
| Voice request | userId → 60s | Redis INCR + EXPIRE | 30/min |
| API login | IP → 15min | `lib/rate-limit/` (Redis sliding) | 5/15min |
| Passkey register | IP → 1h | same module | 3/h |

### Circuit breaker

`lib/ai/circuit-breaker.ts` (Node) and `process-whatsapp/guards.ts:checkCircuitBreaker` (Deno). Per external service (LLM, STT, TTS):

- N consecutive failures → state `open`.
- While `open`, calls rejected immediately with `CircuitBreakerError`.
- After a cool-off, goes to `half-open` and allows a probe call.
- Probe passes → `closed`. Probe fails → `open` again.

### QStash retry ladder

When the handler returns 503 + Retry-After, QStash waits and retries. Combined with circuit breaker:
- LLM rate-limit → 503 + Retry-After (rate-limit seconds).
- Circuit open → 503 + Retry-After=30.
- Transient crash → 503 + Retry-After=15.

The end client (WhatsApp) gets the reply when the backend unblocks. Never sees the error.

### DLQ (Dead Letter Queue)

`supabase/functions/_shared/supabase.ts:logToDLQ`. Fatal errors or bugs go to a `dlq` table with `rawBody` + `error` + `service`. Allows reproducing the case and postmortem.

## 19. Notifications (in-app + push + WhatsApp)

### In-app (dashboard bell)

`notifications` table:
```sql
id          uuid PRIMARY KEY,
business_id uuid,
title       text,
content     text,
type        text CHECK (type IN ('info','success','warning','error')),
metadata    jsonb,
read_at     timestamptz,
created_at  timestamptz
```

Hook `lib/hooks/use-in-app-notifications.ts` subscribes via Supabase Realtime to `notifications WHERE business_id = X` and keeps an unread badge.

TTL: daily cron purges `notifications` with `created_at < now() - 30 days` (migration `20260418000000_notifications_ttl.sql`).

### Push notifications (Web Push + VAPID)

- `lib/push-notifications/` + `supabase/functions/push-notify/`.
- VAPID keys in env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).
- User grants permission → service worker registers subscription → saved in `push_subscriptions`.
- Any `notifications` with certain `type` triggers push via `push-notify` edge function.

### WhatsApp notifications

When an appointment is created/cancelled/rescheduled via the WA channel, the bot also sends a business-branded message to the client via `whatsapp-service`. Verifiable in `process-whatsapp/tool-executor.ts`.

## 20. Internationalization (i18n)

- `next-intl 4` with namespace-per-file under `messages/{locale}/`.
- Supported locales: `es` (default), `en`, `fr`, `de`, `it`, `pt`.
- App Router carries the locale in the path: `/[locale]/dashboard/...`.
- Middleware (`middleware.ts`) detects the browser locale and redirects on first hit.
- Server Components use `useTranslations(namespace)` (next-intl-aware).

## 21. PWA and service worker

- `@ducanh2912/next-pwa` (better-maintained fork of next-pwa).
- Custom service worker handles:
  - Static asset cache.
  - Push notifications.
  - Offline fallback for `/dashboard`.
- Installable on mobile and desktop.

## 22. Authentication, session and Passkeys

### Auth flow

- **Supabase Auth** handles email/password + Google OAuth.
- **Magic links** for employee invitations.
- **JWT** signed by Supabase → `@supabase/ssr` persists it in httpOnly + secure cookies.
- Middleware reads the cookie and populates `auth.uid()` in RLS.

### Session timeout

`lib/auth/with-session-timeout.ts` wraps API routes that require active session. If JWT is expired → 401 + clear-cookie.

### Passkeys (WebAuthn)

- `@simplewebauthn/server` to verify credentials.
- `@simplewebauthn/browser` to create them.
- Flow:
  1. `/api/passkey/register/options` → server issues challenge.
  2. Browser signs with Touch ID / Windows Hello → POST to `/api/passkey/register/verify`.
  3. Server validates and persists credential in `webauthn_credentials`.

Detail: `docs/architecture/PASSKEY_WEBAUTHN_IMPLEMENTATION.md`.

## 23. Frontend — App Router + RSC + state

### Structure

```
app/
├─ [locale]/
│  ├─ layout.tsx               ← LocaleProvider + ThemeProvider + Providers (RQ)
│  ├─ dashboard/
│  │  ├─ layout.tsx            ← Sidebar + AuthGuard
│  │  ├─ appointments/
│  │  ├─ clients/
│  │  ├─ finances/
│  │  ├─ plans/                ← plan cards + referrals
│  │  ├─ settings/
│  │  │  ├─ team/              ← invite employees
│  │  │  ├─ branding/          ← logo + colors
│  │  │  ├─ working-hours/
│  │  │  ├─ ai-rules/          ← free-form instructions for the bot
│  │  │  └─ payment-method-modal.tsx
│  │  ├─ profile/
│  │  └─ admin/payments/       ← platform_admin only
│  ├─ login/
│  ├─ register/
│  └─ invite/[code]/
├─ api/...
└─ auth/callback/
```

### Patterns

- **RSC by default**: `'use client'` is only marked when there is state, events or hooks.
- **Server Actions** for dashboard mutations. Direct Supabase access with cookies → RLS applies.
- **TanStack Query** for client-side data fetching where granular cache + invalidation is needed.
- **Realtime subscriptions** for `notifications` and `appointments`.
- **Zod schemas** shared between forms and server-side validation.

### Voice assistant in the dashboard

- Recorder via `MediaRecorder` API (mobile) or `WebSpeech` API (desktop).
- POST to `/api/assistant/token` to obtain a short-lived JWT (~1 min).
- POST audio/JSON to the edge → reply `{text, audioUrl, actionPerformed}`.
- TTS plays in the browser. `actionPerformed=true` invalidates affected queries.

### Proactive welcome

`/api/assistant/proactive` (GET) runs on dashboard mount. Generates a dynamic greeting with `get_today_summary` using Groq + Deepgram Aura-2 TTS.

## 24. Database — schema and migrations

69 versioned migrations in `supabase/migrations/`. Categories:

| Category | Examples |
|---|---|
| Base schema | `businesses`, `users`, `services`, `clients`, `appointments`, `appointment_services` |
| RLS hardening | `20260413..._fix_users_rls_tenant_isolation.sql`, `20260414..._rls_current_business_id.sql`, `20260415..._fix_users_rls_recursion.sql` |
| Security fixes | `20260410000001_fix_security_definer_view.sql`, `20260410000002_fix_function_search_paths.sql`, `20260410000003_final_privacy_hardening.sql` |
| Performance | `20260411..._composite_indexes_hot_paths.sql`, `20260412..._performance_phase1.sql` |
| Realtime | `20260421010000_appointments_realtime.sql`, `20260421160000_notifications_realtime.sql` |
| Cron | `20260421120000_activate_cron_reminders.sql`, `20260421170000_fix_cron_reminders_hourly.sql` |
| Payments | `20260430120000_saas_invoices.sql`, `20260502000000_manual_payments.sql`, `20260516120000_paypal_support.sql`, `20260516130000_paypal_finalize_rpc.sql` |
| Referrals | `20260504100000_referral_system.sql` |
| Storage | `20260421000000_logos_storage_bucket.sql` |
| WhatsApp | `20260419183229_add_phone_get_businesses_at_hour.sql`, `20260516000000_wa_rpc_phone_normalization.sql`, `20260515120000_harden_client_uniqueness.sql` |
| Idempotency | `20260416000000_transactions_idempotency.sql`, `20260420000002_fn_batch_create_transactions.sql` |
| Custom RPCs | `20260420000001_fn_create_business_and_link_owner.sql`, `20260420000005_client_debts_rpc.sql`, `20260420000006_fn_reschedule_appointment_wa.sql`, `20260412000003_dashboard_stats_rpc.sql` |
| AI | `20260518000000_ai_memory_v2.sql`, `20260519000000_ai_traces.sql`, `20260520000000_entity_relationships.sql`, `20260521000000_ai_training_export.sql` |

### Relevant custom RPCs

- `fn_create_business_and_link_owner` — atomic onboarding.
- `fn_batch_create_transactions` — atomic batch of financial movements.
- `fn_book_appointment_wa` — phone-keyed idempotent booking.
- `fn_reschedule_appointment_wa` — WA reschedule with upsert by phone_digits.
- `fn_finalize_paypal_payment` — atomic idempotency with FOR UPDATE.
- `fn_wa_check_rate_limit` — atomic sliding window.
- `client_debts_rpc` — live debt calculation.
- `dashboard_stats_rpc` — dashboard metrics in a single query.
- `match_ai_memories_v2` — vector search with tenant filter.
- `ai_traces_sample_window` — sampling for training export.
- `get_businesses_at_hour` — for reminder crons.

## 25. Test suite

Detail in `docs/TESTING.md`. Summary:

- **114 test files**.
- Vitest unit + integration + Playwright E2E.
- Critical tests:
  - `TenantEnforcer.test.ts` + `adversarial.test.ts` (multi-tenant).
  - `BookingEngine.test.ts` + resolvers (domain).
  - `parity.test.ts` for each `_shared/` module (Node↔Deno).
  - `fast-path.test.ts` for each voice-worker capability.
  - `nowpayments.test.ts` (HMAC).
- Target coverage: 90% in use-cases, 85% in `lib/ai/core`, 80% in `lib/payments`.

## 26. Quality and CI/CD pipelines

- **Pre-commit (Husky + lint-staged)**: `eslint --fix` on staged files.
- **Pre-push**: `npm run lint && npm run typecheck && npm test && npm audit`. Any failure cancels the push. **Do not use `--no-verify`**.
- **Vercel preview** on every PR. `PAYPAL_ENV` is not set to `live` there.
- **Sentry release** auto-created on merge to `main`.
- **Supabase migrations** applied manually with `npx supabase db push` after review.

Detail: `docs/operations/CI_CD_GATEKEEPER.md`.

## 27. Deployment and operating costs

### Deployment

- **Vercel**: `git push` to `main` → preview build. Manual promotion to production.
- **Supabase Edge Functions**: `npx supabase functions deploy <name>`.
- **Migrations**: `npx supabase db push`.
- **pg_cron**: configured via SQL in migrations.

### Costs today

**$0/month**. Free tiers of Groq, Gemini, Deepgram, Supabase, Upstash and Vercel cover the MVP.

## 28. Architectural decisions (interview FAQ)

### Why two runtimes instead of a unified monorepo?

Supabase Edge Functions run on Deno. Deno has its own module resolver (`.ts` explicit in imports), doesn't understand `@/` paths, and uses `Deno.env`. Forcing a single runtime would force me to:
- Bundle Node → Edge with esbuild → high deploy latency + painful debug.
- Or abandon Edge Functions and use Vercel Cron (more expensive and higher latency when fetching to Postgres).

The option I took (two runtimes with duplicated `_shared/` + parity tests) is the balance between simplicity and reuse.

### Why phantom types for `TenantContext`?

A `businessId: string` is indistinguishable from "any string" to TypeScript. A junior could write `bookingEngine.create('uuid-of-another-business', ...)` and it would compile. Phantom-typed `TenantContext` makes **only `TenantEnforcer.verify()`** capable of emitting one. It's safety by types, not by convention.

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

## 29. Defense script by level

### Junior

"Cronix is a multi-tenant SaaS for booking appointments via WhatsApp and a dashboard with a voice assistant. It's built with Next.js 15, React 19, TypeScript, Tailwind, Supabase (Postgres + Edge Functions + RLS) and Upstash (Redis + QStash). I wrote the dashboard frontend, payment server actions, repositories against Supabase, and unit tests. The most interesting thing I learned: how to isolate tenants with Postgres RLS and TypeScript phantom types, and how to avoid duplicate bookings with a per-turn fingerprint."

### Middle

"The stack is Next.js 15 (App Router + RSC) on Vercel for the dashboard and Server Actions, and Deno Edge Functions on Supabase for the AI agents (voice-worker, process-whatsapp) and webhooks. The runtime separation is physical — Node and Deno don't import each other — and we share logic by duplicating byte-by-byte under `supabase/functions/_shared/` with parity tests that fail on the slightest drift.

AI uses Groq (Llama 3.3-70B + 3.1-8B with key rotation) and optional Gemini as fallback chain. Embeddings with `gte-small` running inside Supabase Edge runtime. STT/TTS with Deepgram Nova-2/Aura-2. All on free tiers — the production stack costs $0/month.

Multi-tenant isolation is 5-layer: compile-time `TenantContext` phantom type, runtime `TenantEnforcer.verify()` with check against `users.business_id`, `.eq('business_id', X)` filters in every repository, RLS in Postgres, and a semantic `ConstitutionalReviewer` reviewing the coherence of every write.

Payments with three gateways converging to `saas_invoices`: PayPal with async webhook + atomic `fn_finalize_paypal_payment` RPC with `FOR UPDATE` (atomic Postgres idempotency), NOWPayments crypto via QStash with back-pressure, and manual with admin approval. The referral system adds 30 days to the referrer when their referee closes the first `finished` payment.

Tests: 114 files between unit (Vitest), integration (against local Supabase), components (RTL) and E2E (Playwright). Adversarial tests against prompt injection and cross-tenant. Pre-push runs lint + tsc + vitest + npm audit; no `--no-verify`."

### Senior

"The project tackles two scale problems: LLM hallucinations in operations with side effects (booking), and data isolation in multi-tenant SaaS.

For hallucinations I implemented **10 verifiable mechanisms** combined: phantom typing of the tenant context, total fast-paths without LLM, deterministic date-guard, corpus frame-cutoff, per-turn fingerprint dedup, response bypass (`return_direct`), 2-turn confirmation gate that passes `tools=[]` to the model, embedded `<function>` recovery, semantic router with precomputed embeddings, and a fail-open constitutional reviewer with rubric versioned in code.

For isolation I also combined 5 layers: phantom-typed `TenantContext`, `TenantEnforcer` with DB check, filtered repositories + ownership asserts, RLS with `current_business_id()` derived from JWT, and the constitutional reviewer detecting semantic `TENANT_MISMATCH`.

Noteworthy decisions I justify:
- Byte-by-byte duplication of `lib/ai/{memory,router,supervisor,training,observability}` under `supabase/functions/_shared/` with parity tests because Deno and Node can't cross-import and bundling was more expensive.
- Zero synthesis LLM calls in WhatsApp when the tool succeeded: using a deterministic template closes the `400→circuit-breaker→503` loop we suffered.
- `PAYPAL_ENV=live` explicit opt-in because Vercel sets `NODE_ENV=production` in previews — without opt-in every PR would charge real money.
- Fail-open in the reviewer because the first 4 layers are sufficient and blocking legitimate bookings due to reviewer flakiness is worse than letting one anomalous edge case through.
- Episodic memory with TTL instead of eternal retention because the reviewer only needs recent context (10 min) to detect `DUPLICATE_INTENT`.

Observability: every turn generates an `ai_traces` row with latency, tokens, tool sequence (no args), outcome and query_hash (truncated SHA-256). A daily cron samples up to 500 traces per business, buckets them and exports them to `ai_training_exports` with `schema_version`. Zero PII guaranteed by types.

Idempotent payments with RPC `fn_finalize_paypal_payment` using `SELECT ... FOR UPDATE` — Postgres locks the second caller until the first commits, and the second sees `status='finished'` → returns `already_processed`. Atomic at DB level, no distributed claim or application locks.

Stack that fits in $0/month: Groq free + Gemini free + Deepgram $200 credits + Supabase free + Upstash free + Vercel free. End-to-end voice latency: 1.2-2.0s. WhatsApp with QStash retry ladder absorbs LLM rate-limits transparently to the client.

The suite covers 114 files: adversarial tests against prompt-injection, Node-Deno parity, fast-paths, RPC idempotency, RLS audit, Playwright E2E. Pre-push runs lint + tsc + vitest + npm audit."

## 30. Glossary

| Term | Definition |
|---|---|
| BookingEngine | Central class that executes all appointment operations. `lib/ai/core/booking/BookingEngine.ts`. |
| TenantContext | Phantom-typed object proving the caller verified the tenant. Only `TenantEnforcer.verify()` emits it. |
| Fast-path | Agent path that runs a tool without going through the LLM, based on deterministic text patterns. |
| LLM Bypass | Returning the tool's response directly to the user, without re-synthesis. `return_direct=True` pattern. |
| Constitutional Reviewer | Reviewer LLM (Groq 8B) emitting verdict on semantic coherence of every write. Fail-open. |
| Frame-cutoff | History point where the corpus is cut to avoid contamination from old attempts. |
| Per-turn fingerprint | Canonical `(toolName + sortedArgs)` hash preventing executing the same tool twice in the same turn. |
| RLS | Postgres Row Level Security. Policy filtering rows by JWT conditions. |
| Parity test | Test verifying two files (Node and Deno) are byte-equivalent. |
| Fail-open | Policy where a component's failure does NOT block the main flow — only the error is logged. |
| Idempotency | Executing the same operation N times produces the same final state as executing it once. |
| Anaphora | Reference to a conversational antecedent ("cancel it" → last appointment mentioned). |
| QStash | Upstash queue with dedupe + retry. |
| ReAct loop | LLM Reason+Act pattern: model decides which tool to call, sees the result, decides the next. |
| ToolResult | Type returned by every BookingEngine operation. Never throws. |
| pgvector | Postgres extension for vectors and similarity search. |
| gte-small | Lightweight embeddings model (384 dim, L2-normalized) running inside Supabase Edge AI. |
| VAPID | Web Push standard for authenticating the server. |
| Phantom type | TypeScript type with a `unique symbol` brand that doesn't exist at runtime but prevents direct construction. |
| Single source of truth | Pattern where a single entity governs multiple consumers. |
