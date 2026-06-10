# Training-data pipeline (`ai_training_exports`)

## Propósito

Generar diariamente datasets JSONL versionados **sin PII** a partir de `ai_traces`. Sirven para:
1. Auditar la salud del agente por negocio.
2. Entrenar/fine-tunear modelos propios en el futuro (clasificadores de outcome, predictores de error, etc.).
3. Demostrar a clientes empresariales que los datos del agente son inspeccionables.

## Componentes

| Pieza | Archivo |
|---|---|
| Schema `TrainingSample` + buckets | `lib/ai/training/contracts.ts` |
| Transformación pura | `lib/ai/training/TrainingExporter.ts` |
| Duplicado Deno | `supabase/functions/_shared/training/TrainingExporter.ts` |
| Edge Function cron-driven | `supabase/functions/export-ai-traces/index.ts` |
| RPC sampler | `ai_traces_sample_window(business_id, range_start, range_end, limit)` |
| Tabla destino | `ai_training_exports` (migración `20260521000000_ai_training_export.sql`) |

## Pipeline

```
pg_cron 03:00 UTC daily
        │
        ▼
POST /functions/v1/export-ai-traces  (Authorization: Bearer CRON_SECRET)
        │
        ▼
Para cada business_id:
    1. Llama RPC ai_traces_sample_window
       (samplea hasta 500 trazas del último 24h)
    2. rpcRowToSampleRow:
       trace_id, created_at, channel, outcome, error_code,
       total_tokens, latency_ms, steps_count, tools_count,
       tool_sequence, intent
    3. buildExportSummary(sampleRows, rangeStart, rangeEnd):
       samples = rows.map(rowToSample):
         {
           trace_id, created_at, channel,
           outcome, error_code,
           tool_sequence,            ← solo nombres, no args
           latency_bucket:  bucketLatency(latencyMs),
           tokens_bucket:   bucketTokens(totalTokens),
           steps_count, tools_count,
           intent
         }
    4. INSERT INTO ai_training_exports {
         business_id, range_start, range_end,
         sample_count, jsonl, schema_version
       }
```

## Buckets

`TrainingExporter.ts:21-41`:

```ts
LATENCY_FAST_MAX     = 800
LATENCY_NORMAL_MAX   = 2000
LATENCY_SLOW_MAX     = 5000

bucketLatency(ms) → 'fast' | 'normal' | 'slow' | 'critical'

TOKENS_LOW_MAX       = 200
TOKENS_MEDIUM_MAX    = 800
TOKENS_HIGH_MAX      = 2000

bucketTokens(n) → 'low' | 'medium' | 'high' | 'extreme'
```

Buckets viven en código, NO en DB. Cambiar un threshold no requiere migración. `schema_version` solo se incrementa si cambia el **shape** del JSONL.

## Zero-PII garantizado

El transformador `rowToSample` solo lee:
- `trace_id`, `created_at` (timestamp, no contenido)
- `channel`, `outcome`, `error_code`
- `tool_sequence` (nombres de tools, no args)
- `latency_ms`, `total_tokens` (señales numéricas)
- `steps_count`, `tools_count`
- `intent` (etiqueta, no texto)

**Nunca toca**: `userText`, `query_hash`, `final_text_sha`, `metadata`, IDs personales, teléfonos, nombres, args de tools. La función es pura — TypeScript impide acceder a campos no listados en `SampleRow`.

## Schema version

`TRAINING_SCHEMA_VERSION` se exporta desde `contracts.ts`. Al cambiar el shape del `TrainingSample` (añadir/quitar/renombrar campos) hay que:
1. Incrementar la constante.
2. Aplicar parity test (Node ↔ Deno).
3. Comunicar el cambio a consumidores.

## Seguridad

- Endpoint exige `Authorization: Bearer ${CRON_SECRET}`.
- `service_role` para escribir en `ai_training_exports` (RLS bloquea inserts directos desde el cliente).
- Sentry envuelve cada negocio individualmente — si uno falla, los otros continúan.

## Tests

- `__tests__/ai/training/TrainingExporter.test.ts` — bucket boundaries + `rowToSample` shape + `buildExportSummary` count.
- `__tests__/ai/training/parity.test.ts` — byte-equality entre Node y Deno.
- `__tests__/ai/training/contracts.test.ts` — `TRAINING_SCHEMA_VERSION` no cambia accidentalmente.
