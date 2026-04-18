# WhatsApp AI System Architecture (Backend)

> Last updated: 2026-04-18. Reflects unified notification pipeline and AI hardening guardrails.

This document details the end-to-end operation of the AI agent deployed on Supabase Edge Functions to process WhatsApp messages. This architecture is completely decoupled from the Next.js frontend and operates asynchronously.

---

## 1. Call Flow (End-to-End)

### Phase 1: Reception and Enqueuing (The Webhook)

**File:** `supabase/functions/whatsapp-webhook/index.ts`

1. Meta (WhatsApp) sends an HTTP POST to this webhook.
2. **Security (Layer 1):** Validates the `HMAC-SHA256` signature from Meta.
3. **Decoupling:** Injects the raw payload into **QStash (Upstash)** queue. Responds `200 OK` to Meta in < 50ms.

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
  └─ emitBookingEvent({ type, appointmentId, clientName, serviceName, date, time, businessId })
        │
        ▼
  notifications.ts → NotificationService.handle(AppointmentEvent)
        ├─ event_id = crypto.randomUUID()
        ├─ INSERT notifications (UNIQUE event_id) → idempotent, retries are safe
        ├─ Supabase Realtime → dashboard UI
        └─ WhatsApp owner alert (time formatted as HH:mm, userId = 'whatsapp-agent')
```

**Eliminated:** The legacy `createInternalNotification` and direct `sendWhatsAppMessage` calls that bypassed idempotency. All notifications now go through the single pipeline.

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

## 4. Advantages

- **Zero message loss:** QStash retry + `wa_dead_letter_queue` for unrecoverable failures.
- **Idempotent notifications:** UNIQUE constraint prevents duplicate alerts on QStash retries.
- **Dual-model efficiency:** Small model (8B) for logic, large model (70B) for copywriting.
- **Anti-hallucination:** `tool-executor.ts` uses Zero-Trust architecture — LLM cannot mutate DB directly.
- **Dashboard isolation:** Async Edge Functions do not affect Next.js performance.
- **Structured event data:** Write tools return typed `BookingEventData` — no regex on result strings.

---

## 5. Known Limitations

- **Race conditions on concurrent bookings:** If two phones attempt the same slot simultaneously, PostgreSQL row-level locks are the last defense. QStash does not guarantee strict ordering.
- **Vendor dependencies:** Upstash, Groq, Meta WhatsApp Cloud API — each is a potential failure point. Circuit Breaker mitigates LLM-side failures.
- **No automated E2E tests for WhatsApp flow:** Requires real phone simulation. Current coverage: unit tests for `tool-executor.ts` and `notifications.ts`; no full conversation replay.
- **`cron-reminders` ongoing 500 errors:** Unrelated to notification hardening. Requires separate investigation (possible secret rotation or clock configuration issue).
