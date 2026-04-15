# Luis IA — Master Architecture Guide

> Current architecture as of 2026-04-14. Prior versions (V8.0 / AssistantService) are fully retired.

---

## 1. System Philosophy

Luis IA is a production-grade AI orchestrator for multi-tenant service businesses. It handles real-time voice and text interactions, executing business logic through a clean-architecture stack with strict TypeScript typing, zero mocks in production, and full Redis-backed session persistence.

Core design principles:
- **Domain isolation**: UseCases never import Supabase, HTTP, or AI concerns.
- **Repository pattern**: All DB access behind typed interfaces (`IAppointmentQueryRepository`, `IClientRepository`, etc.).
- **Result<T> contract**: Every repository and use case returns `Result<T>` — never throws.
- **Stateless route handlers**: All state lives in Redis, never in module-level singletons.

---

## 2. Orchestration Pipeline

```
Voice/Text Input (route.ts)
        │
        ▼
  AiOrchestrator.process(AiInput)
        │
        ├── Redis: load ConversationState (turnCount, flow, draft, history)
        │
        ▼
  DecisionEngine.analyze(input, state)
        │
        ├── Fast path: reject / execute_immediately (awaiting_confirmation + "sí")
        └── LLM path: reason_with_llm (Decision with messages + toolDefs)
        │
        ▼
  ExecutionEngine.execute(Decision)
        │
        ├── LlmBridge.call(messages, toolDefs)  →  GroqProvider.chat()
        │         LLM returns: text or tool_call
        │
        ├── [tool_call] RealToolExecutor.execute(toolName, args, businessId)
        │         → UseCase (CreateAppointment, CancelAppointment, etc.)
        │         → Supabase via IRepository
        │
        └── [text] ExecutionResult (text, actionPerformed, tokens, llmMessages)
        │
        ▼
  AiOrchestrator: update ConversationState, persist to Redis
        │
        ▼
  route.ts: TTS (Deepgram) + HTTP response
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
- Detects booking intent, confirmation/rejection signals, and turn limits.
- Builds system prompt with: services list, working hours, today's appointments, AI rules, voice format instructions, tool chaining flow, security rules.
- Builds `toolDefs` filtered by user role strategy (`IUserStrategy`).

### `ExecutionEngine` (`lib/ai/orchestrator/execution-engine.ts`)
- Runs the ReAct loop (max 5 steps).
- Calls `LlmBridge` → receives text or tool call.
- If tool call: delegates to `IToolExecutor`, appends result to message chain, loops.
- Accumulates real token counts from Groq `usage.total_tokens`.
- Returns `llmMessages` (full message chain for history propagation).

### `LlmBridge` (`lib/ai/orchestrator/LlmBridge.ts`)
- Thin adapter: converts `ExecutionEngine` message format → `GroqProvider.chat()`.
- Returns `MockLlmResponse` with text, tool call (if any), and token count.

### `RealToolExecutor` (`lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts`)
- Implements `IToolExecutor`. Routes by tool name to private methods.
- All Zod schemas use **snake_case** — must match LLM tool definition field names exactly.
- Instantiates UseCases on demand (no singletons).
- Client resolution: `clientId` takes priority → fuzzy match on `client_name` fallback.

### `RedisStateManager` (`lib/ai/orchestrator/RedisStateManager.ts`)
- Persists `ConversationState` in Upstash Redis (TTL: 2 hours).
- Key format: `session:{sessionId}`.
- Handles JSON serialization/deserialization with type safety.

---

## 4. Strategy & RBAC

`StrategyFactory.forRole(userRole)` returns an `IUserStrategy`:

| Role | Strategy | Allowed Tools |
|------|----------|--------------|
| `owner` / `staff` | `InternalUserStrategy` | All 7 tools |
| `external` | `ExternalUserStrategy` | `confirm_booking`, `cancel_booking`, `reschedule_booking`, `get_appointments_by_date`, `get_services`, `get_available_slots` |

`create_client` is internal-only — external callers must already be registered clients.

---

## 5. Conversation State Machine

```
idle
  └─[booking intent]──► collecting_booking
  └─[reschedule intent]► collecting_reschedule
  └─[cancel intent]────► awaiting_confirmation

collecting_booking
  └─[LLM calls confirm_booking]──► idle (reset turnCount)
  └─[turnCount >= maxTurns]──────► idle (abort)

awaiting_confirmation
  └─["sí"]──► execute_immediately ──► idle (reset turnCount)
  └─["no"]──► idle
```

`maxTurns` defaults to 5 per flow segment. After a successful action, `turnCount` resets to 0.

---

## 6. Tool Call History Propagation

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

## 7. Voice Pipeline

```
Client (browser)
  └─ MediaRecorder (WebM/Opus)
         │
         ▼ POST /api/assistant/voice
  route.ts
    ├─ Groq Whisper (whisper-large-v3-turbo) → transcript
    ├─ AiOrchestrator.process() → response text
    └─ Deepgram Aura 2 (aura-2-nestor-es) → audio Buffer
         │
         ▼
  Audio response (audio/mpeg)
```

---

## 8. Key Design Rules

- All Zod schemas in `RealToolExecutor` must use **snake_case** (matching LLM tool definitions).
- `create_client` response includes the UUID so LLM can chain directly to `confirm_booking` with `client_id`.
- `get_available_slots` uses `workingHours` from `businesses.settings` JSON blob — passed through `AiInput.context.workingHours`.
- `date` is always `YYYY-MM-DD`, `time` is always `HH:mm` 24h in all tool parameters.
- No `any` types. No `console.log`. No module-level singletons in production.
