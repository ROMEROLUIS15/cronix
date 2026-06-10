# Observabilidad de IA (`ai_traces`)

## Propósito

Cada turno conversacional (voz o WhatsApp) abre un `TraceHandle` que acumula latencias, tokens, tool calls, error codes y outcome final. Al cerrar, persiste un row en `ai_traces`. Esto alimenta el dashboard de salud y el pipeline diario de training-data.

## Componentes

| Pieza | Archivo |
|---|---|
| Interfaces `ITracer`, `ITraceHandle`, `ITraceSink` | `lib/ai/observability/contracts.ts` |
| Implementación `Tracer` + `TraceHandle` | `lib/ai/observability/Tracer.ts` |
| Sink Postgres `PgTraceSink` | `lib/ai/observability/PgTraceSink.ts` |
| Hashing util (SHA-256 truncado) | `lib/ai/observability/hashing.ts` |
| Factoría runtime | `lib/ai/observability/index.ts` |
| Duplicado Deno | `supabase/functions/_shared/observability/` |

## Tabla

```sql
-- migración 20260519000000_ai_traces.sql
CREATE TABLE ai_traces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('voice', 'whatsapp')),
  actor_kind      text NOT NULL,
  actor_key       text NOT NULL,
  query_hash      text NOT NULL,              -- SHA-256 trunc de userText
  outcome         text NOT NULL,              -- success | failure | error | rate_limited | no_action
  error_code      text,
  final_text_sha  text,
  total_tokens    int NOT NULL DEFAULT 0,
  latency_ms      int NOT NULL,
  steps_count     int NOT NULL DEFAULT 0,
  tools_count     int NOT NULL DEFAULT 0,
  llm_steps       jsonb NOT NULL DEFAULT '[]',
  tool_calls      jsonb NOT NULL DEFAULT '[]',
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_traces (business_id, created_at DESC);
```

## API runtime

```ts
const trace = tracer.start(
  { businessId, channel: 'whatsapp', actorKind: 'client_phone', actorKey: sender },
  await shortHash(userText),
  { memory_hits, intent, intent_confidence },
)

// durante el agent loop:
trace.recordLlmStep({ model, latencyMs, tokens, hadToolCalls })

// para cada tool ejecutada:
trace.recordToolCall({
  tool, durationMs,
  status: 'success' | 'error' | 'rate_limited',
  argsFingerprint: await shortHash(JSON.stringify(args)),
  errorCode: optional,
})

// al cerrar el turno:
await trace.finish({ outcome, errorCode, finalTextSha })
```

## Por qué hashing

- `query_hash`: SHA-256 truncado del texto del usuario. Permite agrupar consultas idénticas sin almacenar PII.
- `final_text_sha`: hash de la respuesta del bot. Permite detectar respuestas duplicadas/template-driven sin guardar el texto.
- `argsFingerprint`: hash de los args de la tool. Permite ver patrones de duplicación sin ver IDs reales.

## Outcome state machine

```
        ┌──────────────────────────┐
        │ no_action                │  ← ningún tool call, ningún texto
        │ (cliente saludó, etc.)   │
        └──────────────────────────┘
        ┌──────────────────────────┐
        │ success                  │  ← tool exitosa O respuesta texto OK
        └──────────────────────────┘
        ┌──────────────────────────┐
        │ failure                  │  ← tool con error conocido (SLOT_CONFLICT, etc.)
        └──────────────────────────┘
        ┌──────────────────────────┐
        │ rate_limited             │  ← LlmRateLimitError o RATE_LIMIT en tool error
        └──────────────────────────┘
        ┌──────────────────────────┐
        │ error                    │  ← loop exhausted, circuit breaker, excepción
        └──────────────────────────┘
```

Determinado en `ai-agent.ts` (WhatsApp) y `agent.ts` (voz).

## Por qué nunca lanza

Si la observabilidad fallara y propagara, perderíamos turnos válidos. Por eso:
- `Tracer.start` siempre retorna un handle.
- `recordLlmStep` / `recordToolCall` después de `finish` son no-op.
- `finish.sink.write` falla → `onError` log, no throw.

## Tests

- `__tests__/ai/observability/Tracer.test.ts` — record + finish + idempotencia.
- `__tests__/ai/observability/PgTraceSink.test.ts` — payload shape, insert.
- `__tests__/ai/observability/hashing.test.ts` — SHA-256 determinismo + length.
- `__tests__/ai/observability/parity.test.ts` — byte-equality entre Node y Deno.
