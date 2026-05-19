# Edge Function `embed-text`

## Propósito

Servir embeddings `gte-small` (384 dim, L2-normalized) **dentro del runtime de Supabase Edge** sin pagar API externa. Es consumido por:
- `lib/ai/memory/Embedder.ts` y su gemelo Deno (`_shared/memory/Embedder.ts`).
- `lib/ai/router/...` durante `npm run seed:intents` (offline).

## Implementación

```ts
// supabase/functions/embed-text/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const model = new Supabase.ai.Session('gte-small')

serve(async (req) => {
  const { text } = await req.json()
  if (!text) return new Response(JSON.stringify({ error: "Missing text" }), { status: 400 })

  try {
    const embedding = await model.run(text, { mean_pool: true, normalize: true })
    return new Response(JSON.stringify({ embedding }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
})
```

## Por qué no usar OpenAI embeddings

- **Costo**: `text-embedding-3-small` cobra ~$0.02/1M tokens. Volumen actual cabe en el free plan de Supabase Edge AI.
- **Latencia**: la llamada `embed-text` queda dentro de la misma región Supabase → typical 50-150ms. Una API externa añade ~200-400ms.
- **Privacy**: el texto del usuario no sale de la infra de Supabase.

## Configuración runtime

- `mean_pool: true` — promedia los embeddings token-level a uno por documento.
- `normalize: true` — L2 normalize → cosine = dot product (cheap).
- Dimension: 384 (fijo en `gte-small`).

## Consumidores

### `SupabaseEdgeEmbedder` (Node-side)

```ts
// lib/ai/memory/Embedder.ts
export class SupabaseEdgeEmbedder implements IEmbedder {
  public readonly dimensions = 384

  async embed(text: string): Promise<Result<ReadonlyArray<number>>> {
    if (!text.trim()) return { ok: false, error: 'EMPTY_INPUT' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const res = await fetch(this.endpoint, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.serviceKey}`,
          'apikey':        this.serviceKey,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify({ text: text.trim() }),
        signal: controller.signal,
      })
      if (!res.ok) return { ok: false, error: `EMBED_HTTP_${res.status}` }
      const { embedding } = await res.json()
      if (!Array.isArray(embedding) || embedding.length !== 384) {
        return { ok: false, error: 'EMBED_SHAPE_MISMATCH' }
      }
      return { ok: true, value: embedding }
    } catch (err) {
      return { ok: false, error: `EMBED_NETWORK: ${err.message}` }
    } finally {
      clearTimeout(timer)
    }
  }
}
```

Validaciones defensivas: 384 dim exacto, timeout 4s con AbortController, Result-type (nunca lanza).

### `MemoryEngine.recall`

Embed → RPC `match_ai_memories_v2` → array de hits ordenados por similarity descendente.

### `SemanticRouter.classify`

Embed → for each prototype: cosine vs vector precalculado → mejor sobre threshold.

### `seed-intent-embeddings.ts` (offline)

Para cada `IntentDefinition.examples[]`, embed → escribe JSON precalculado a:
- `lib/ai/router/intent-embeddings.generated.json`
- `supabase/functions/_shared/router/intent-embeddings.generated.json`

(Ambos archivos quedan idénticos — el parity test del router lo garantiza.)

## Despliegue

```bash
npx supabase functions deploy embed-text
```

JWT verification: **disabled** en `supabase/config.toml` para que `service_role` pueda llamarla sin renegociar tokens. Acceso controlado por la `Authorization: Bearer <SERVICE_KEY>` que solo conocen los runtimes internos.

## Tests

- `__tests__/ai/memory/Embedder.test.ts` — mocks de fetch + shape validation + timeout.
- E2E indirecto: cualquier test que use `MemoryEngine.recall` o `SemanticRouter.classify` con embedder real ejercita esta función.
