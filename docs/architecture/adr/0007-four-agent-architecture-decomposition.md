# ADR 0007: 4-Agent Architecture Decomposition

## Status
**Accepted (May 2026)**

## Context

The original Cronix AI system had two independent agents:

- **WhatsApp Agent** (`process-whatsapp/`): 7 files, ~1,200 lines of monolithic ReAct loop + tool definitions + booking logic + notifications + rate limiting
- **Voice Agent** (`voice-worker/agent.ts`): 506 lines of monolithic LLM loop with fast-path, date guard, deduplication, and synthesis bypass

Both agents independently implemented the same patterns: tool-calling protocol, provider selection, rate limiting, observability tracing, and constitutional review. Adding a third channel (e.g., SMS, web chat) would mean duplicating the entire stack.

## Decision

We decomposed the monolithic agent loops into **4 specialized agents** coordinated by a shared **Pipeline Engine**:

```
┌─────────────────────────────────────────────────────────┐
│                    Orchestrator                          │
│  (message-handler.ts / agent.ts — entry points)          │
│  Route → Guard → Pipeline → Response                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
 │  Booking Agent          │  Client Agent               │
 │  (booking-adapter.ts)   │  (context-fetcher.ts,       │
 │  confirm / cancel /     │   clients repo)             │
 │  reschedule ops         │  resolve / create / search   │
 │                         │                              │
 ├─────────────────────────┴──────────────────────────────┤
 │                                                         │
 │  Supervisor (constitutional review)                     │
 │  Memory (pgvector recall)                               │
 │  Schedule (available-slots)                             │
 │  Observability (tracing + metrics)                      │
 │                                                         │
 └─────────────────────────────────────────────────────────┘
```

### Agent Responsibilities

| Agent | Responsibility | Entry Point |
|---|---|---|
| **Orchestrator** | Route messages, run prelude checks, invoke Pipeline | `message-handler.ts:handleMessage()` / `agent.ts:runAgent()` |
| **Booking Agent** | Appointment CRUD (confirm, cancel, reschedule) | `booking-adapter.ts` (WhatsApp) / `capabilities/schedule/` (Voice) |
| **Client Agent** | Client resolution, creation, search, ambiguity handling | `context-fetcher.ts` (WhatsApp) / `core/repos/clients.ts` (Voice) |
| **Supervisor** | Constitutional guard for write operations | `_shared/supervisor/` |

### Pipeline Engine as Coordinator

The Pipeline Engine replaces the manual orchestration in both agents:

```
WhatsApp pipeline (message-pipeline.ts):
  fetch-context → run-agent → send-response → log-interaction

Voice pipeline (voice-pipeline.ts):
  llm-loop → (build-output in agent.ts)
```

Both pipelines use the same `Pipeline<T>` class from `_shared/pipeline/`. Steps are plain functions — no framework lock-in.

## Consequences

- **Positive**:
  - WhatsApp handler: 337 → 281 lines (16% reduction)
  - Voice agent: 506 → 226 lines (55% reduction)
  - New channel can be added by defining 4-5 pipeline steps and registering capabilities
  - Each agent is independently testable via its step functions
- **Negative**:
  - Pipeline adds a thin abstraction layer — developers must learn the step pattern
  - Some responsibilities overlap between WhatsApp's `context-fetcher.ts` and Voice's `core/repos/` — unification is future work

## Alternatives Considered

1. **Single shared agent with channel adapter**: Rejected — WhatsApp (phone-identified clients) and Voice (name-identified clients) have fundamentally different client resolution that makes a shared agent unwieldy.
2. **5+ agents**: Rejected — divides the system too finely; 4 agents cover all current responsibilities without fragmentation.
3. **Event-driven agent communication (message bus)**: Overkill for 2 channels — the Pipeline's sequential step model is sufficient for request-response.

---

*Signed: Systems Architect*
