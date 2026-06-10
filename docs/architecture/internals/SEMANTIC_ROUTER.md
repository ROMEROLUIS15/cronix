# Semantic Router

## Propósito

Clasifica el texto del usuario en uno de 9 intents canónicos usando **embeddings precalculados** + cosine similarity. Cero llamadas a LLM en runtime para enrutamiento.

## Componentes

| Pieza | Archivo |
|---|---|
| Definiciones canónicas (9 intents + ejemplos) | `lib/ai/router/intents.ts` |
| Embeddings precalculados (offline) | `lib/ai/router/intent-embeddings.generated.json` + `supabase/functions/_shared/router/intent-embeddings.generated.json` |
| Clase `SemanticRouter` | `lib/ai/router/SemanticRouter.ts` |
| Factoría runtime | `lib/ai/router/index.ts`, `_shared/router/index.ts` |
| Script de seeding | `scripts/seed-intent-embeddings.ts` |

## Intents

| Intent | Uso típico |
|---|---|
| `book_appointment` | Cliente quiere agendar/apartar/reservar |
| `cancel_appointment` | Cliente quiere anular |
| `reschedule_appointment` | Cliente quiere mover fecha/hora |
| `check_availability` | Cliente pregunta por disponibilidad |
| `pricing_inquiry` | Cliente pregunta precio |
| `list_appointments` | Cliente pregunta por sus citas |
| `greeting` | Saludo sin intención |
| `affirmation` | Confirmación (usado por confirmation-gate) |
| `negation` | Rechazo |

## Pipeline

```
                       Offline (npm run seed:intents)
                       ─────────────────────────────
  intents.ts (examples)
        │
        ▼
  embed-text Edge Fn (gte-small)
        │
        ▼
  intent-embeddings.generated.json   ← committed (con git)
  (duplicado en _shared/)


                       Runtime
                       ───────
  user text
        │
        ▼
  SemanticRouter.classify(text, { threshold = 0.78 })
        ├── embedder.embed(text)          → 384-dim L2-normalized vector
        ├── for proto in prototypes:
        │     sim = cosine(text_vec, proto_vec)
        │     if sim > threshold && sim > best.confidence:
        │         best = { intent, confidence: sim, matched }
        └── return best | null
```

## Cosine optimization

`gte-small` devuelve embeddings ya L2-normalizados. Para vectores unitarios, **cosine = dot product** (no hay que normalizar de nuevo). Implementación en `SemanticRouter.ts`:

```ts
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] ** 2
    magB += b[i] ** 2
  }
  if (Math.abs(magA - 1) < 0.01 && Math.abs(magB - 1) < 0.01) return dot   // fast path
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))                          // defensive
}
```

## Threshold

Default 0.78. Por debajo se devuelve `null` — el LLM toma el turno normal. Por encima se enriquece el system prompt con la etiqueta de intent y se habilita lógica especial (e.g. confirmation-gate cierra cuando intent === `negation`).

## Por qué embeddings precalculados

- Reentrenar los prototipos requiere correr el script offline → versionado controlado.
- En runtime cada `classify` cuesta **una sola llamada** al embedder (~100ms) + N multiplicaciones-suma vectoriales.
- El embedder vive dentro de Supabase Edge (`Supabase.ai.Session('gte-small')`) → cero API externa.

## Tests

- `__tests__/ai/router/SemanticRouter.test.ts` — classify con fakes deterministas.
- `__tests__/ai/router/intents.test.ts` — schema de `IntentDefinition`.
- `__tests__/ai/router/parity.test.ts` — byte-equality entre Node y Deno.
- `__tests__/ai/router/embeddings.test.ts` — valida que el JSON tiene 384 dim por prototipo.
