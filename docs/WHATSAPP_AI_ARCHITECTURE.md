# WhatsApp AI System Architecture (Backend)

> Last updated: 2026-04-18. Reflects unified notification pipeline, AI hardening guardrails, owner WA notification fix, and QStash transparent rate-limit retry.

This document details the end-to-end operation of the AI agent deployed on Supabase Edge Functions to process WhatsApp messages. This architecture is completely decoupled from the Next.js frontend and operates asynchronously.

---

## 1. Call Flow (End-to-End)

### Phase 1: Reception and Enqueuing (The Webhook)

**File:** `supabase/functions/whatsapp-webhook/index.ts`

1. Meta (WhatsApp) sends an HTTP POST to this webhook.
2. **Security (Layer 1):** Validates the `HMAC-SHA256` signature from Meta.
3. **Decoupling:** Injects the raw payload into **QStash (Upstash)** queue. Responds `200 OK` to Meta in < 50ms.
4. **Retry budget:** `Upstash-Retries: 5` — each message gets up to 5 processing attempts before going to DLQ.
5. **Deduplication:** `Upstash-Deduplication-Id: msg.id` — prevents processing the same Meta event twice.

### Phase 2: Processing and Orchestration

**Files:** `process-whatsapp/index.ts` → `message-handler.ts`

1. QStash dequeues and calls `process-whatsapp` with automatic retry (Exponential Backoff).
2. **Security (Layer 2):** Verifies QStash signature (`security.ts`) — no JWT required.
3. **Error Boundary:** On crash, original payload is stored in `wa_dead_letter_queue` for cold debugging.
4. **Voice:** If audio received, `downloadMediaBuffer` + Groq Whisper → clean transcript.

### Phase 3: Context Loading (RAG)

1. **`business-router.ts`:** Resolves tenant via session hash (`#slug`) or anchored `wa_sessions` record.
2. **`guards.ts`:** Rate limits, token quotas, Circuit Breaker pattern.
3. **`context-fetcher.ts`:** Loads from PostgreSQL:
   - Business profile, services, working hours, AI rules
   - Active appointments (next 14 days)
   - Conversation history (last 4 turns from `wa_audit_logs`)
   - → Produces `BusinessRagContext`

### Phase 4: ReAct Loop and Resolution

**Files:** `ai-agent.ts` → `tool-executor.ts`

1. **Reasoning model (Llama-3.1-8b):** Analyzes intent, decides tool call or text response.
2. **`tool-executor.ts`:** Validates args, executes DB mutation, returns `{ success, result, data }` — structured payload, no string parsing.
3. **Response model (Llama-3.3-70b):** Converts the tool result into a warm, human-readable WhatsApp message.

### Phase 5: Notification Dispatch (Unified Pipeline)

After any write tool succeeds, the **unified event pipeline** is triggered (no direct DB inserts or WhatsApp calls outside this pipeline):

```
tool-executor.ts (write success)
  └─ emitBookingEvent({ type, businessId, businessName, clientName, serviceName, date, time })
        │
        ▼
  notifications.ts → emitBookingEvent()
        ├─ Idempotency check: SELECT FROM notifications WHERE event_id = ?
        ├─ INSERT notifications (UNIQUE event_id) → retries safe
        ├─ Supabase Realtime broadcast → dashboard UI
        └─ sendOwnerWhatsApp()
              ├─ Resolves owner phone from businesses.phone (set via VINCULAR-slug)
              └─ POST whatsapp-service { type: 'text', to: phone, message, businessName }
                      └─ Meta API: free-text message to owner's personal WhatsApp
```

**Single transport point:** `whatsapp-service` handles all outbound WhatsApp messages for the entire system:
- `type: 'text'` — free-text messages (owner booking alerts, built by `buildOwnerWhatsAppMessage`)
- `type: 'template'` — pre-approved Meta templates (client appointment reminders from `cron-reminders`)

**Eliminated:** Legacy `createInternalNotification`, hardcoded `businessName: 'tu negocio'`, and `users` table phone lookup that always returned null. All owner WA alerts now use the verified phone from `businesses.phone`.

---

## 2. Hardening Guardrails

The WhatsApp agent (as of 2026-04-18) does **not** implement the same confirmation interception or availability-claim guards as the web orchestrator, because:

- The WhatsApp flow uses a single-model ReAct loop (no `DecisionEngine`/`ExecutionEngine` split).
- Confirmation is handled conversationally — the LLM asks "¿Confirmas?" before calling write tools.
- The structured `data` return from `tool-executor.ts` eliminates all string parsing for notification dispatch.

Future versions may adopt shared guardrail primitives.

---

## 3. Notification Idempotency

| Property | Value |
|----------|-------|
| `event_id` | `crypto.randomUUID()` — generated per operation |
| DB constraint | `UNIQUE(event_id)` on `notifications` table |
| Retry safety | Duplicate inserts silently ignored by constraint |
| `userId` for WA events | `'whatsapp-agent'` sentinel (never a real user UUID) |
| Time format | `HH:mm` (24h) — consistent between web and WA paths |

---

## 4. Rate Limit Resilience (QStash Transparent Retry)

When Groq returns HTTP 429 (rate limit), `message-handler.ts` does **not** send an error message to the client. Instead:

```
Groq → 429 (retry-after: 30s)
  └─ process-whatsapp → HTTP 503 + Retry-After: 30
        └─ QStash waits exactly 30s → retries automatically
              └─ Client receives response transparently (~30s delay)
```

- `retryLater(retryAfterSecs)` builds the 503 response with the exact `Retry-After` value from Groq's header.
- Applies to both LLM rate limits and Whisper (voice) rate limits.
- `CircuitBreakerError` (service genuinely down for minutes) still sends a user-facing message — that case cannot self-resolve within the retry window.

---

## 5. Advantages

- **Zero message loss:** QStash retry (5 attempts) + `wa_dead_letter_queue` for unrecoverable failures.
- **Transparent rate limiting:** Groq 429 → QStash retries silently. Client never sees "try again" messages.
- **Idempotent notifications:** UNIQUE constraint prevents duplicate alerts on QStash retries.
- **Dual-model efficiency:** Small model (8B) for logic, large model (70B) for copywriting.
- **Anti-hallucination:** `tool-executor.ts` uses Zero-Trust architecture — LLM cannot mutate DB directly.
- **Dashboard isolation:** Async Edge Functions do not affect Next.js performance.
- **Structured event data:** Write tools return typed `BookingEventData` — no regex on result strings.
- **Single WA transport:** `whatsapp-service` is the only point that calls Meta API — no scattered direct calls.

---

## 6. Known Limitations

- **Race conditions on concurrent bookings:** If two phones attempt the same slot simultaneously, PostgreSQL row-level locks are the last defense. QStash does not guarantee strict ordering.
- **Vendor dependencies:** Upstash, Groq, Meta WhatsApp Cloud API — each is a potential failure point. Circuit Breaker mitigates LLM-side failures.
- **No automated E2E tests for WhatsApp flow:** Requires real phone simulation. Current coverage: unit tests for `tool-executor.ts` and `notifications.ts`; no full conversation replay.
- **Owner WA notifications require prior VINCULAR-slug:** If the business owner has not run the `VINCULAR-{slug}` command to verify their phone, `businesses.phone` will be null and the notification is silently skipped. The booking itself is unaffected.

---

## 7. Configuration Requirements

| Secret / Config | Where set | Purpose |
|----------------|-----------|---------|
| `CRON_SECRET` | Supabase project secrets + `supabase/.env` | Auth between `process-whatsapp` and `whatsapp-service` |
| `WHATSAPP_PHONE_NUMBER_ID` | Supabase project secrets | Meta API sender ID |
| `WHATSAPP_ACCESS_TOKEN` | Supabase project secrets | Meta API bearer token |
| `QSTASH_TOKEN` | Supabase project secrets | Publish to QStash queue |
| `config.toml` | `[functions.whatsapp-service]` `verify_jwt = false` | Allow internal service-to-service calls |
