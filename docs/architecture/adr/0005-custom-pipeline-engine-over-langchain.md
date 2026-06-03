# ADR 0005: Custom Pipeline Engine over LangChain/LangGraph

## Status
**Accepted (May 2026)**

## Context

The Cronix AI system routes messages through two Edge Functions:
- `process-whatsapp` (WhatsApp AI agent — 337 lines in `message-handler.ts`)
- `voice-worker` (Voice AI agent — 506 lines in `agent.ts`)

Both contain monolithic loops that manually implement the OpenAI-compatible tool-calling protocol: send messages, execute tool calls, loop until final text. This duplication means every bug fix or feature must be applied twice.

The industry standard for agent orchestration is LangChain/LangGraph. However, Cronix runs on Supabase Edge Functions powered by Deno 1.x, which cannot import Node.js-specific dependencies (`fs`, `path`, `process`, `stream`, `events`). LangChain's Deno support is experimental and incomplete — critical modules like `RunnableSequence`, tool-calling abstractions, and LangGraph's graph execution are unavailable.

## Decision

We built a **custom Pipeline Engine** (~75 lines) in `supabase/functions/_shared/pipeline/Pipeline.ts` with:

```
Pipeline<T>
  .step(name, fn, { if?, timeoutMs? })
  .on({ onStepStart?, onStepComplete?, onStepError? })
  .run(initial) → { context, results }
```

Key properties:
- **Generic**: `Pipeline<T>` with typed context propagation across steps
- **Composable**: Steps are plain async functions `(ctx) => Partial<T>`
- **Observable**: Lifecycle hooks for tracing, metrics, and error handling
- **Conditional**: `if` predicate per step for branching
- **Timeout**: Per-step timeout via `timeoutMs`
- **Error isolation**: Step errors halt the pipeline predictably

The engine is **provider-agnostic** — the same Pipeline handles Groq, Gemini, or any OpenAI-compatible provider. It does not lock us into LangChain's abstraction layer.

## Consequences

- **Positive**:
  - WhatsApp `message-handler.ts`: 337 → 281 lines (4 pipeline steps)
  - Voice `agent.ts`: 506 → 226 lines (1 pipeline step in `voice-pipeline.ts`)
  - All agent logic is independently testable as step functions
  - ~200 lines of shared engine vs ~10MB of LangChain deps
  - Zero npm dependencies for orchestration
- **Negative**:
  - No pre-built LangChain integrations (vector stores, retrievers, memory — we implement these ourselves in `_shared/memory/` and `_shared/supervisor/`)
  - Team must understand the Pipeline abstraction rather than using an industry-standard framework

## Alternatives Considered

1. **LangChain/LangGraph**: Rejected — Deno 1.x cannot import required Node.js modules. LangChain's `Deno` support is marked experimental and lacks LangGraph execution.
2. **Vercel AI SDK**: Rejected — tightly coupled to Vercel's streaming paradigm; our use case is request-response with no streaming.
3. **Stay monolithic**: Rejected — duplicated agent loops across two Edge Functions, each requiring independent maintenance.

---

*Signed: Systems Architect*
