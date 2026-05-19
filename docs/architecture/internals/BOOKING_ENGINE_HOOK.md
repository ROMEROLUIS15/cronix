# `BookingEngine.onBeforeDispatch` Hook

## Propósito

Inyectar **un punto de validación pre-escritura** sin acoplar `BookingEngine` al supervisor concreto. El engine acepta una closure async; el call-site (process-whatsapp o voice-worker) la construye habiendo capturado `userUtterance` y `recentMemory` del turno actual.

## Contrato

```ts
// lib/ai/core/booking/BookingEngine.ts

export type BookingWriteTool =
  | 'confirm_booking'
  | 'cancel_booking'
  | 'reschedule_booking'

export type DispatchGuardResult =
  | { ok: true }
  | { ok: false; reason: string }

export type OnBeforeDispatchHook = (
  toolName: BookingWriteTool,
  toolArgs: Readonly<Record<string, unknown>>,
  ctx:      TenantContext,
) => Promise<DispatchGuardResult>
```

## Activación

Solo las tools listadas en `REVIEWED_WRITE_TOOLS` pasan por el hook:

```ts
const REVIEWED_WRITE_TOOLS: ReadonlySet<BookingWriteTool> = new Set([
  'confirm_booking',
  'cancel_booking',
  'reschedule_booking',
])
```

Reads (`get_appointments_by_date`, `get_available_slots`, `search_clients`) y writes que no afectan agenda (`create_client`) **no** se revisan — el costo no se justifica.

## Inyección desde el call-site

### Voice-worker (`supabase/functions/voice-worker/agent.ts`)

```ts
if (reviewer) {
  const recalled = await memoryEngine.recall(scope, input.text, { topK: 5 })
  ctx = {
    ...ctx,
    runWriteGuard: async (toolName, args) => {
      const outcome = await reviewWriteOrFailOpen({
        reviewer, toolName, args,
        scope:         { businessId: ctx.businessId, channel: 'voice' },
        userUtterance: input.text,
        recentMemory:  recalled.map(...),
      })
      if (outcome.allowed) return null
      return { success: false, result: `No puedo ejecutar esa acción: ${outcome.reason}` }
    },
  }
}
```

### WhatsApp (`supabase/functions/process-whatsapp/ai-agent.ts`)

```ts
const writeGuard: WriteGuard | undefined = reviewer
  ? async (toolName, args) => {
      const outcome = await reviewWriteOrFailOpen({
        reviewer, toolName, args,
        scope:         { businessId: business.id, channel: 'whatsapp' },
        userUtterance: userText,
        recentMemory:  recalled.map(...),
      })
      return outcome.allowed ? null : { blocked: true, reason: outcome.reason }
    }
  : undefined
```

## Memoria como invariante

`reviewWriteOrFailOpen` lanza `TypeError` si `recentMemory` no es array. Esto fuerza al call-site a **invocar `memoryEngine.recall` una vez al inicio del turno** y pasar el resultado al guard. No se permite "recall lazy desde dentro del guard" porque crearía un segundo round-trip a la DB por cada tool en el loop.

## Comportamiento al bloquear

```ts
async dispatch(ctx, toolName, rawArgs, engineOpts) {
  if (this.onBeforeDispatch && isReviewedWriteTool(toolName)) {
    const verdict = await this.onBeforeDispatch(toolName, args, ctx)
    if (!verdict.ok) {
      return toolFail('UNAUTHORIZED', `Acción bloqueada por el revisor: ${verdict.reason}`)
    }
  }
  // … resto del dispatch
}
```

El loop del agente ve `success: false` con un mensaje en español, lo agrega como tool-message en el historial, y el LLM puede reformular o pedir clarificación al usuario.

## Por qué un hook y no una clase abstracta

- **Inversión de dependencias**: el engine no sabe nada del reviewer concreto. Mañana podría ser un classifier ML, un workflow N8N, una rule engine — el engine no cambia.
- **Test isolation**: el `BookingEngine` se prueba con `onBeforeDispatch = async () => ({ ok: true })` o con un mock que retorna `{ ok: false, reason: '...' }`. Sin acoplar a `IReviewer`.
- **Construcción tardía**: el hook captura el `userUtterance` y `recentMemory` del turno actual mediante closure — no se pueden inyectar como dependencias de constructor porque cambian por request.

## Tests

- `lib/ai/core/__tests__/BookingEngine.test.ts` cubre:
  - `dispatch` sin hook (todas las tools fluyen).
  - `dispatch` con hook que retorna `{ ok: true }` (todas las tools fluyen).
  - `dispatch` con hook que retorna `{ ok: false, reason: '...' }` → `toolFail('UNAUTHORIZED')`.
  - `dispatch` con hook que solo revisa la lista whitelist (reads pasan, writes no listados pasan).
- Integration: el guard real se prueba en `__tests__/ai/supervisor/guard.test.ts`.
