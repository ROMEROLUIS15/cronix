# Dashboard AI Assistant — Technical Overview

> Current architecture as of 2026-04-29. Replaces v6.5 (AssistantService, tool-registry.ts, book_appointment, 7 old tools).

---

## Overview

The Dashboard AI Assistant ("Luis") is a voice-first executive assistant for business owners and staff. It runs entirely server-side via `app/api/assistant/voice/route.ts`, backed by an AI orchestrator built on clean architecture principles.

---

## AI Interaction Model

Luis uses **OpenAI-compatible Function Calling** via the Groq API. The LLM receives a structured system prompt and a set of tool definitions, then decides which tool to call based on user intent. Tool calls are executed server-side by `RealToolExecutor`, which maps each tool name to a domain UseCase.

### Tool Catalog (8 tools)

| Tool | Type | Description |
|------|------|-------------|
| `confirm_booking` | WRITE | Creates a new appointment. Requires `service_id`, `client_name` or `client_id`, `date`, `time`. |
| `cancel_booking` | WRITE | Cancels an appointment by `appointment_id`. |
| `reschedule_booking` | WRITE | Moves an appointment to a new date/time. Requires `appointment_id`, `new_date`, `new_time`. |
| `get_appointments_by_date` | READ | Returns all active appointments for a given `date`. Includes appointment IDs for cancel/reschedule chaining. |
| `get_services` | READ | Lists all active services with name, price, and duration. |
| `get_available_slots` | READ | Returns free time slots for a given `date` and `duration_min`. Subtracts booked intervals from working hours. |
| `search_clients` | READ | Searches a client by name via fuzzy match. Returns a structured prefix (`CLIENT_FOUND`, `MULTIPLE_CLIENTS`, or `CLIENT_NOT_FOUND`) that the LLM must follow without inventing ambiguity. |
| `create_client` | WRITE | Registers a new client. Returns the new `client_id` so the LLM can immediately chain to `confirm_booking`. |

### Tool Parameter Format
- `date`: always `YYYY-MM-DD`
- `time`: always `HH:mm` in 24-hour format
- `appointment_id`, `service_id`, `client_id`: UUIDs from tool responses or system prompt context

---

## Architecture Stack

```
app/api/assistant/voice/route.ts
  ├── Groq Whisper (STT) → transcript
  ├── AiOrchestrator.process(AiInput)
  │     ├── DecisionEngine → Decision (reason_with_llm / execute_immediately / reject)
  │     └── ExecutionEngine → ReAct loop → RealToolExecutor → UseCases → Supabase
  └── Deepgram Aura 2 (TTS) → audio/mpeg response (shieldOutput guard applied before TTS)
```

### SOLID Architecture (as of 2026-04-29)

The Dashboard Agent follows SOLID principles through a set of abstractions in `lib/ai/agents/`:

| File | Role |
|------|------|
| `lib/ai/agents/IAgent.ts` | Interface: `IAgent`, `ResolvedEntities`, `ToolDefEntry`, `AgentConfig` |
| `lib/ai/agents/dashboard/index.ts` | `dashboardAgent` — concrete implementation of `IAgent` |
| `lib/ai/providers/tts-factory.ts` | `createTtsProvider(apiKey?, model)` — TTS provider factory (OCP) |
| `supabase/functions/process-whatsapp/confirmation-gate.ts` | `lastAssistantWasConfirmation()`, `isAffirmative()`, `toolsAllowedThisTurn()` (SRP extraction) |

**DIP**: `DecisionEngine` receives an `IAgent` via constructor injection — it depends on the abstraction, not the concrete `dashboardAgent`.

**OCP**: `AiChannel` type (`'web' | 'whatsapp' | (string & {})`) and `AppointmentEvent.channel` are open for extension without modification.

**SRP**: Confirmation gate logic extracted from `message-handler.ts` into its own module.

### State Management
- `ConversationState` is persisted in **Upstash Redis** (TTL: 30 mins) via `RedisStateManager`.
- State includes: `flow`, `turnCount`, `maxTurns`, `draft`, `lastIntent`, `lastToolResult`, and crucially `lastAction` (used for short-term entity memory).
- History: up to 20 messages (tool call chains included, not condensed).

### Conversation Flows
- `idle` → `collecting_booking` → `idle` (after successful booking)
- `idle` → `awaiting_confirmation` → `idle` (after confirm/reject)
- `turnCount` resets to 0 after each successful action.

### Memory & Fast Paths (Zero-Latency)
- **lastAction Caching**: The state manager implicitly caches the `lastAction` executed in the session. This is injected into the system prompt for all internal staff, allowing fluid entity chaining (e.g. "elimina la cita que acabo de agendar", "reagéndala para mañana") without reprompting.
- **Fast Paths**: Staff users (`owner`, `employee`) skip the LLM entirely (0 cognitive latency) applying Regex models if their query matches known deterministic patterns (day queries, explicitly complete booking phrases, or simple cancellations referencing `lastAction`).

---

## Fuzzy Matching Engine

Located at `lib/ai/fuzzy-match.ts`. Used by `RealToolExecutor.resolveClient()` when `client_id` is not provided, and also as the backend of the `search_clients` tool.

Resolution priority:
1. If `client_id` is present → direct DB lookup (no fuzzy match needed).
2. If `client_name` only → `fuzzyFind()` against all active clients for the business.
3. `create_client` tool response includes the new `client_id` — subsequent `confirm_booking` calls use it directly, bypassing fuzzy match.

### `search_clients` — Structured Output Protocol

Before calling `confirm_booking`, the LLM should call `search_clients(query)`. The executor returns one of three machine-readable prefixes:

- `CLIENT_FOUND: <name>. Usa este nombre exacto…` — exactly one match. LLM must use that name directly, **no clarification question**.
- `MULTIPLE_CLIENTS: <name1>, <name2>…` — two or more candidates. LLM must ask the user which to use.
- `CLIENT_NOT_FOUND: "<query>" no existe…` — no match. LLM offers to register; if confirmed, calls `confirm_booking` with the original name (auto-creates the client).

This eliminates LLM hallucination of ambiguity ("¿Te refieres a cuál?") when only one client matches.

---

## Voice Pipeline

- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — server-side, <1s for 5s audio. Features automatic failover (API Key Pooling) on 429 Rate Limits.
- **LLM**: Groq (`llama-3.3-70b-versatile` primary) — features API Key Pooling to gracefully rotate across multiple credentials if quota limits are reached. Heavily instructed for hyper-flexible semantic service matching ("tarjeta" -> "Tarjetas").
- **TTS**: Deepgram Aura 2 (`aura-2-nestor-es`) — low-latency natural Spanish voice.
- **Fallback TTS**: Browser `SpeechSynthesis` API (client-side, zero cost).

---

## RBAC (Role-Based Tool Access)

| Role | Available Tools |
|------|----------------|
| `owner` / `staff` | All 8 tools including `create_client` |
| `external` | `confirm_booking`, `cancel_booking`, `reschedule_booking`, `get_appointments_by_date`, `get_services`, `get_available_slots`, `search_clients` |

`create_client` is reserved for internal users only. External callers must already be registered in the system.

---

## Context Injected per Request

Each AI request loads from the database and injects into the system prompt:
- Business name (`businesses.name`)
- Active services list with UUIDs and prices (processed semantically, not strictly)
- Working hours (`businesses.settings.workingHours`)
- Custom AI rules (`businesses.settings.aiRules`)
- Today's active appointments (up to 5, with IDs)
- Current date/time in business timezone

---

## Observability & Dispatch Rules

- **Notification Suppression**: Appointments created natively via the Dashboard Assistant (`channel: 'web'`) trigger Realtime DB UI updates but are strictly configured to suppress redundant WhatsApp confirmation blasts to the business owner, assuming they are actively operating the dashboard.
