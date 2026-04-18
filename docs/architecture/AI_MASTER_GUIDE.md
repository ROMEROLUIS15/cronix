# Luis IA — Master Architecture Guide

> Last updated: 2026-04-18. Prior versions (V8.0 / AssistantService) are fully retired.

---

## 1. System Philosophy

Luis IA is a production-grade AI orchestrator for multi-tenant service businesses. It handles real-time voice and text interactions, executing business logic through a clean-architecture stack with strict TypeScript typing, zero mocks in production, and full Redis-backed session persistence.

Core design principles:
- **Domain isolation**: UseCases never import Supabase, HTTP, or AI concerns.
- **Repository pattern**: All DB access behind typed interfaces (`IAppointmentQueryRepository`, `IClientRepository`, etc.).
- **Result<T> contract**: Every repository and use case returns `Result<T>` — never throws.
- **Stateless route handlers**: All state lives in Redis, never in module-level singletons.
- **Deterministic behavior**: LLM outputs are constrained by runtime guardrails — hallucinations are intercepted, not trusted.

---

## 2. Orchestration Pipeline

```
Voice/Text Input (route.ts)
  │
  ├─ [voice] Groq Whisper → transcript
  ├─ [text] Input validation → reject empty / noise-only payloads
  │
  ▼
AiOrchestrator.process(AiInput)
  │
  ├── Redis: load ConversationState (turnCount, flow, draft, history)
  │
  ▼
DecisionEngine.analyze(input, state)
  │
  ├── [Guard] Services guard: reject if services=[] (business not configured)
  ├── [Normalize] extractEntities(text, timezone) → resolved date + time
  │     → injects "ENTIDADES YA RESUELTAS" into system prompt (no LLM parsing)
  ├── Fast path: reject (turn limit / rejection keyword)
  ├── Fast path: execute_immediately (awaiting_confirmation + "sí")
  └── LLM path: reason_with_llm { messages, toolDefs }
        ├── buildSystemPrompt() — services (id+name), hours, appointments,
        │    resolved entities, AI rules, voice format, security rules
        └── buildToolDefsForRole(strategy) — RBAC-filtered tool list
  │
  ▼
ExecutionEngine.execute(Decision)
  │
  ├── [Hard Guard] Confirmation interception (write tool before confirmation):
  │     if WRITE_TOOL && flow ≠ awaiting_confirmation && strategy.requiresConfirmation():
  │       → buildConfirmationSummary() → return without executing
  │       → nextState.flow = 'awaiting_confirmation'
  │
  ├── [Hard Guard] UUID state priority lock:
  │     service_id, client_id, appointment_id from state.draft OVERRIDE LLM args
  │
  ├─ loop (max 5 steps):
  │   ├── LlmBridge → GroqProvider.chat(messages, toolDefs)
  │   │     LLM returns: text | tool_call + real token count
  │   │
  │   ├── [Hard Guard] Availability claim guard:
  │   │     if LLM text contains "disponib*|libre|slot" && no read-tool was called
  │   │     → sanitize: replace with neutral redirection
  │   │
  │   ├── [Hard Guard] Write-action claim guard:
  │   │     if LLM text implies booking/cancel/reschedule && no write-tool was called
  │   │     → sanitize: replace with neutral redirection
  │   │
  │   └── [tool_call] RealToolExecutor.execute(params)
  │           ├── Zod schema validation (snake_case, exact match)
  │           ├── UseCase → IRepository → Supabase
  │           └── returns { success, result, data? } — structured payload, no string parsing
  │
  ▼
AiOrchestrator: update ConversationState, persist to Redis
  │
  ├── emitBookingEvent(data) → NotificationService
  │     ├── DB insert (notifications table, UNIQUE event_id → idempotent)
  │     ├── Supabase Realtime broadcast → UI update
  │     └── WhatsApp owner alert (formatted message)
  │
  ▼
route.ts: TTS (Deepgram Aura 2) + HTTP response
```

---

## 3. Component Reference

### `AiOrchestrator` (`lib/ai/orchestrator/ai-orchestrator.ts`)
- Public facade. Receives `AiInput`, returns `AiOutput`.
- Loads and saves `ConversationState` via `RedisStateManager`.
- Appends tool call history as LLM messages (not condensed text).
- Resets `turnCount` to 0 after `actionPerformed && flow === 'idle'`.
- Caps conversation history at 20 messages.

### `DecisionEngine` (`lib/ai/orchestrator/decision-engine.ts`)
- Pure function: `analyze(input, state) → Decision`.
- **Services guard**: returns `reject` if `context.services` is an empty array (business not configured). Does not reject if `services` is `undefined` (loading state).
- **Entity normalization**: calls `extractEntities(text, timezone)` (from `lib/ai/utils/date-normalize.ts`) to deterministically resolve dates and times. Injects resolved values into system prompt as `ENTIDADES YA RESUELTAS` — eliminates LLM date parsing.
- Detects booking intent, confirmation/rejection signals, and turn limits.
- Builds system prompt with: services list (id + name + price + duration), working hours, today's appointments, AI rules, voice format instructions, tool chaining flow, security rules, resolved entities.
- Builds `toolDefs` filtered by user role strategy (`IUserStrategy`).
- Exports `buildConfirmationSummary(toolName, args, services)` for use by `ExecutionEngine`.

### `ExecutionEngine` (`lib/ai/orchestrator/execution-engine.ts`)
- Runs the ReAct loop (max 5 steps).
- **Confirmation interception (Task 3)**: Before executing any write tool (`WRITE_TOOLS` set), checks `strategy.requiresConfirmation(state)`. If true and `state.flow !== 'awaiting_confirmation'`, intercepts and returns a structured confirmation summary without executing the tool. Owner/platform_admin bypass this gate (their strategy returns `false`).
- **UUID state priority (Task 4)**: When calling a write tool, locked fields (`service_id`, `client_id`, `appointment_id`) from `state.draft` override the LLM-provided arguments. Prevents LLM from overwriting confirmed UUIDs with re-inferred values.
- **Availability claim guard (Task 1)**: After LLM produces a text-only response containing availability keywords, verifies that a read tool (`get_available_slots`, `get_appointments_by_date`) was called this turn. If not, replaces the response with a safe redirection.
- **Write-action claim guard (Task 5)**: After LLM produces a text-only response implying a completed booking/cancel/reschedule, verifies that the corresponding write tool was actually called. If not, replaces with a safe redirection.
- Accumulates real token counts from Groq `usage.total_tokens`.
- Returns `llmMessages` (full message chain for history propagation).

### `date-normalize.ts` (`lib/ai/utils/date-normalize.ts`)
- Pure deterministic utility — no LLM, no network, no side effects.
- `normalizeDateInput(text, timezone) → string | null`: resolves relative terms ("hoy", "mañana", "pasado mañana"), weekday names ("el lunes"), explicit day formats ("el 27", "27 de mayo"), and ISO/EU date formats. Returns `YYYY-MM-DD` or `null`.
- `normalizeTimeInput(text) → string | null`: resolves 12h format ("3pm", "3:30 pm"), 24h format ("15:00"), mediodía/medianoche, and contextual phrases ("3 de la tarde", "a las 3 de la mañana"). Returns `HH:mm` or `null`.
- `extractEntities(text, timezone) → { date: string | null, time: string | null }`: thin wrapper combining both normalizers.
- All functions are safe to call with any input — never throws.
- Covered by 26 unit tests in `__tests__/ai/utils/date-normalize.test.ts`.

### `LlmBridge` (`lib/ai/orchestrator/LlmBridge.ts`)
- Thin adapter: converts `ExecutionEngine` message format → `GroqProvider.chat()`.
- Returns `MockLlmResponse` with text, tool call (if any), and token count.

### `RealToolExecutor` (`lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts`)
- Implements `IToolExecutor`. Routes by tool name to private methods.
- All Zod schemas use **snake_case** — must match LLM tool definition field names exactly.
- Write tools (`confirm_booking`, `cancel_booking`, `reschedule_booking`) return `{ success, result, data: BookingEventData }` — structured payload for event dispatch. No string parsing required downstream.
- Client resolution: `clientId` takes priority → fuzzy match on `client_name` fallback.

### `RedisStateManager` (`lib/ai/orchestrator/RedisStateManager.ts`)
- Persists `ConversationState` in Upstash Redis (TTL: 2 hours).
- Key format: `session:{sessionId}`.
- Handles JSON serialization/deserialization with type safety.

---

## 4. Strategy & RBAC

`StrategyFactory.forRole(userRole)` returns an `IUserStrategy`:

| Role | Strategy | Allowed Tools | `requiresConfirmation()` |
|------|----------|--------------|--------------------------|
| `owner` / `platform_admin` | `InternalUserStrategy` | All 7 tools | `false` — executes directly |
| `employee` | `EmployeeUserStrategy` | All 7 tools | `true` — confirmation required |
| `external` | `ExternalUserStrategy` | 6 tools (no `create_client`) | `true` — confirmation required |

`create_client` is internal-only — external callers must already be registered clients.

**Confirmation flow for `external`/`employee`:**
1. LLM decides to call a write tool → intercepted by `ExecutionEngine`
2. `buildConfirmationSummary()` generates a structured human-readable summary
3. State transitions to `awaiting_confirmation`, `lastIntent` stores the tool name
4. On user "sí" → `DecisionEngine` returns `execute_immediately` with stored args → tool executes
5. On user "no" → `DecisionEngine` returns `reject` → state resets to `idle`

---

## 5. Conversation State Machine

```
idle
  └─[booking intent]──► collecting_booking
  └─[reschedule intent]► collecting_reschedule
  └─[cancel intent]────► awaiting_confirmation (for external/employee)
  └─[cancel intent]────► EXECUTE directly (for owner/platform_admin)

collecting_booking
  └─[LLM calls write tool, owner]────► idle (reset turnCount)
  └─[LLM calls write tool, external]─► awaiting_confirmation
  └─[turnCount >= maxTurns]──────────► idle (abort)

awaiting_confirmation
  └─["sí"/"dale"/"ok"]──► execute_immediately ──► idle (reset turnCount)
  └─["no"/"mejor no"]───► idle
  └─[unrelated text]────► reason_with_llm (re-engage LLM)
```

`maxTurns` defaults to 5 per flow segment. After a successful action, `turnCount` resets to 0.

---

## 6. Notification Pipeline (Unified)

All booking events flow through a single, idempotent pipeline:

```
RealToolExecutor (write tool success)
  └─ returns { data: BookingEventData }
        │
        ▼
emitBookingEvent(data)          ← lib/ai/events.ts (Web)
  OR                            ← process-whatsapp/notifications.ts (WhatsApp)
        │
        ▼
NotificationService.handle(AppointmentEvent)
  ├─ Generate event_id = crypto.randomUUID()
  ├─ INSERT into notifications (UNIQUE constraint on event_id → idempotent)
  ├─ Supabase Realtime → dashboard UI update
  └─ WhatsApp owner alert (formatted, HH:mm time format)
```

**Key properties:**
- `event_id` is generated before DB insert — duplicate events (retries, network errors) are silently ignored by the UNIQUE constraint.
- `userId` for WhatsApp-originated events is `'whatsapp-agent'` (sentinel value) — never confused with a real user UUID.
- No parallel notification system exists — the legacy `createInternalNotification` / `sendWhatsAppMessage` direct calls in `process-whatsapp/notifications.ts` have been eliminated.

---

## 7. Tool Call History Propagation

The full LLM message chain is preserved across turns:

```
Turn N:
  history = [...previous messages]
  LLM returns tool_call → append [assistant+tool_calls, tool+result] → get text response
  Save llmMessages = [user, assistant+tool_calls, tool+result, assistant+text]

Turn N+1:
  history = [...previous, ...llmMessages].slice(-20)
```

This allows the LLM to see full tool results in context, enabling multi-step reasoning across turns (e.g., `create_client` → `confirm_booking` using the returned `client_id`).

---

## 8. Voice Pipeline

```
Client (browser)
  └─ MediaRecorder (WebM/Opus)
         │
         ▼ POST /api/assistant/voice
  route.ts
    ├─ [Validation] Reject empty / noise-only transcripts (< 2 words after trim)
    ├─ Groq Whisper (whisper-large-v3-turbo) → transcript
    ├─ AiOrchestrator.process() → response text
    └─ Deepgram Aura 2 (aura-2-nestor-es) → audio Buffer
         │
         ▼
  Audio response (audio/mpeg)
```

---

## 9. Test Coverage

| Suite | File | What it covers |
|-------|------|---------------|
| **Unit** | `__tests__/ai/utils/date-normalize.test.ts` | 26 tests — all date/time normalization cases, `extractEntities` |
| **Unit** | `__tests__/ai/orchestrator/decision-engine.test.ts` | 35 tests — turn limit, confirmation detection, tool defs by role, system prompt |
| **Unit** | `__tests__/ai/orchestrator/decision-engine-hardening.test.ts` | 16 tests — services guard, entity injection, `buildConfirmationSummary` |
| **Integration** | `__tests__/ai/orchestrator/execution-engine.test.ts` | 14 tests — reject/immediate/ReAct loop paths |
| **Integration** | `__tests__/ai/orchestrator/execution-engine-hardening.test.ts` | 13 tests — all 4 guardrails (availability, write-action, confirmation interception, UUID lock) |
| **Integration** | `__tests__/ai/orchestrator/real-tool-executor.test.ts` | 38 tests — all 7 tools, Zod validation, error paths |

Run: `npx vitest run __tests__/ai/`

---

## 10. Key Design Rules

- All Zod schemas in `RealToolExecutor` must use **snake_case** (matching LLM tool definitions).
- `create_client` response includes the UUID so LLM can chain directly to `confirm_booking` with `client_id`.
- `get_available_slots` uses `workingHours` from `businesses.settings` JSON blob — passed through `AiInput.context.workingHours`.
- `date` is always `YYYY-MM-DD`, `time` is always `HH:mm` 24h in all tool parameters and event payloads.
- Write tools return `{ data: BookingEventData }` — never parse result strings for event construction.
- No `any` types. No `console.log`. No module-level singletons in production.
- `normalizeDateInput` must be checked for `'pasado mañana'` BEFORE `'mañana'` (substring ordering rule).
