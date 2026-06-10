# Memoria episódica vectorial (`ai_memories_v2`)

## Propósito

Persistir hechos relevantes de la conversación (acciones ejecutadas, decisiones tomadas) y recuperarlos por similitud semántica antes de cada escritura supervisada.

## Componentes

| Pieza | Archivo |
|---|---|
| Interfaces `IMemoryEngine`, `IEmbedder`, `IEpisodicStore` | `lib/ai/memory/contracts.ts` |
| Embedder Edge `SupabaseEdgeEmbedder` (timeout 4s) | `lib/ai/memory/Embedder.ts` |
| Store `PgVectorEpisodicStore` (pgvector) | `lib/ai/memory/EpisodicStore.ts` |
| Engine compuesto `MemoryEngine` | `lib/ai/memory/MemoryEngine.ts` |
| Factoría runtime | `lib/ai/memory/index.ts` |
| Duplicado Deno | `supabase/functions/_shared/memory/` |

## Tabla

```sql
-- migración 20260518000000_ai_memory_v2.sql
CREATE TABLE ai_memories_v2 (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_kind  text NOT NULL CHECK (actor_kind IN ('user', 'client_phone')),
  actor_key   text NOT NULL,                    -- userId o phone
  kind        text NOT NULL,                    -- 'episodic' | 'fact' | etc.
  content     text NOT NULL,
  embedding   vector(384) NOT NULL,             -- gte-small
  metadata    jsonb NOT NULL DEFAULT '{}',
  expires_at  timestamptz,                      -- null = never
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_memories_v2 (business_id, actor_kind, actor_key);
CREATE INDEX ON ai_memories_v2 USING ivfflat (embedding vector_cosine_ops);
```

RLS habilitada — la RPC se llama con `service_role` y aplica filtro tenant **antes** del vector scan.

## RPC `match_ai_memories_v2`

```sql
match_ai_memories_v2(
  p_business_id       uuid,
  p_actor_kind        text,
  p_actor_key         text,
  p_query_embedding   vector(384),
  p_match_threshold   float8 = 0.78,
  p_match_count       int    = 5
) RETURNS TABLE(id, content, kind, metadata, similarity, created_at)
```

Filtro tenant antes del vector scan = corrección + performance.

## API runtime

```ts
const memory = createMemoryEngine()   // singleton

const recalled = await memory.recall(
  { businessId, actorKind: 'user', actorKey: userId },
  userText,
  { topK: 5, threshold: 0.78 },
)
// recalled: ReadonlyArray<MemoryRecord>

await memory.write(
  { businessId, actorKind: 'user', actorKey: userId },
  { kind: 'episodic', content: '…', metadata: { … }, ttlDays: 180 },
)
```

`MemoryEngine` nunca lanza. Recall falla → retorna `[]`. Write falla → `onError` log.

## Por qué recall es obligatorio antes del reviewer

El reviewer requiere `recentMemory` como input no-undefined:

```ts
if (!Array.isArray(input.recentMemory)) {
  throw new TypeError('reviewWriteOrFailOpen: recentMemory must be an array (recall is mandatory)')
}
```

Pasar `[]` está bien (memoria vacía ≠ sospecha) pero **olvidar pasarlo es un bug**. La regla es: una sola llamada `recall` por turno, antes del loop, y ese resultado se inyecta tanto al system prompt como al guard.

## TTL

`expires_at` se calcula en runtime: `Date.now() + ttlDays * 86400000`. Default 180 días para episodios. Limpieza la hace un cron diario (no documentado aquí — ver `supabase/functions/cron-reminders/` y migraciones de purging).

## Tests

- `__tests__/ai/memory/MemoryEngine.test.ts` — recall + write happy paths + degrade.
- `__tests__/ai/memory/Embedder.test.ts` — timeout, shape mismatch, HTTP errors.
- `__tests__/ai/memory/EpisodicStore.test.ts` — RPC contract, RLS expectation.
- `__tests__/ai/memory/parity.test.ts` — byte-equality entre Node y Deno.
