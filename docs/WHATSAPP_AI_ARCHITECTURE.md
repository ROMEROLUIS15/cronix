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

1. **Unified Reasoning Model (Llama-3.3-70b):** Both the decision loop and the final response now use the 70B model. This practically eliminates JSON/Tool-calling format leaks while remaining extremely fast on Groq.
2. **Contextual Calendar Injection:** `prompt-builder.ts` directly feeds the exact human-readable dates for "Today" and "Tomorrow" into the System Prompt. This relieves the LLM from calendar-math, eradicating date hallucinations.
3. **Optimized Intent Guardrails:** For cancellations with a *single* appointment, the LLM skips asking "Are you sure?" to save tokens and eliminate UX friction. For multiple appointments or reschedulings, it strictly demands verification.
4. **`tool-executor.ts`:** Validates args, executes DB mutation, returns `{ success, result, data }` — structured payload, no string parsing.

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
                      └─ Injects Authorization: Bearer SUPABASE_SERVICE_ROLE_KEY to bypass Kong 401 blocks
                      └─ Meta API: free-text message to owner's personal WhatsApp
```

**Single transport point:** `whatsapp-service` handles all outbound WhatsApp messages for the entire system:
- `type: 'text'` — free-text messages (owner booking alerts, built by `buildOwnerWhatsAppMessage`)
- `type: 'template'` — pre-approved Meta templates (client appointment reminders from `cron-reminders`)

**Internal Gateway Bridge:** Since `whatsapp-service` sits behind the Supabase API Gateway (verifying JWTs by default), `notifications.ts` strictly injects the `SUPABASE_SERVICE_ROLE_KEY` during its `fetch` dispatch. This prevents `401 Unauthorized` errors when Edge Functions communicate with one another.

---

## 2. Hardening Guardrails

The WhatsApp agent (as of 2026-04-19) implements robust prompt-based constraints:

- The WhatsApp flow uses a single-model ReAct loop heavily anchored by contextual constraints.
- Confirmation is mostly handled conversationally — the LLM asks "¿Confirmas?" before calling write tools, except for direct 1-to-1 cancellations to optimize response tokens.
- The structured `data` return from `tool-executor.ts` eliminates all string parsing for notification dispatch.
- **Empty Output Fallbacks:** If the LLM returns an empty string, the Agent Loop enforces an `INTERNAL_SYNTAX_FALLBACK` instead of crashing the upstream Meta API connection.

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
- **Unified 70B Performance:** High-tier tool-calling format accuracy with sub-2s Groq response times.
- **Anti-hallucination:** `prompt-builder.ts` does exactly the calendar math computation so the LLM doesn't have to guess the dates.
- **Dashboard isolation:** Async Edge Functions do not affect Next.js performance.

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
| `CRON_SECRET` | Supabase project secrets + `supabase/.env` | Webhook identity verification |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project secrets | Automatically injected by Deno to bypass Kong 401 |
| `WHATSAPP_PHONE_NUMBER_ID` | Supabase project secrets | Meta API sender ID |
| `WHATSAPP_ACCESS_TOKEN` | Supabase project secrets | Meta API bearer token |
| `QSTASH_TOKEN` | Supabase project secrets | Publish to QStash queue |

