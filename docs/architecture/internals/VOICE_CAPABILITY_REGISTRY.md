# Voice-Worker Capability Registry

## Propósito

El asistente de voz del dashboard es conversacional y ejecuta muchas intenciones distintas: agendar, cancelar, reagendar, buscar cliente, listar citas, ver disponibilidad, consultar servicios, registrar cliente nuevo, borrar cliente, consultar última visita.

Antiguamente todo vivía en un `tools.ts` monolítico que mezclaba: detección de fast-path, schema LLM, acceso a DB y formato de respuesta. Cada cambio tocaba el archivo entero.

Hoy cada intent vive en su propia carpeta bajo `supabase/functions/voice-worker/capabilities/<intent>/` con un contrato uniforme.

## Estructura

```
supabase/functions/voice-worker/capabilities/
├── _shared/
│   ├── Capability.ts          ← interfaz ICapability
│   └── registry.ts            ← ALL_CAPABILITIES, detectFastPath, executeByName
├── available-slots/
│   ├── index.ts               ← ICapability
│   └── tool.ts                ← schema LLM + execute(args, ctx)
├── cancel/
│   ├── index.ts
│   ├── tool.ts
│   ├── fast-path.ts           ← detector(text, today, tz, history, lastRef) → args | null
│   └── __tests__/fast-path.test.ts
├── create-client/             (sin fast-path — solo LLM-driven)
├── delete-client/             (con fast-path "elimina al primero")
├── get-services/
├── last-visit/
├── list-appointments/         (con fast-path "qué tengo mañana")
├── reschedule/                (con fast-path anafórico "reagéndala")
├── schedule/
└── search-clients/
```

## Contrato `ICapability`

```ts
export interface ICapability<Args extends Record<string, unknown> = Record<string, unknown>> {
  readonly name:       string         // tool name expuesto al LLM
  readonly isWrite:    boolean        // afecta DB → notifications + lastRef
  readonly bypassLLM:  boolean        // si true, la prosa de la tool se devuelve directo sin re-síntesis LLM
  readonly definition: ToolDefinition // schema OpenAI-style (expuesto al LLM vía getToolDefinitions())

  /** Retorna args para execute(), o null si no aplica el fast path. */
  detectFastPath(input: FastPathInput): Args | null

  /** Ejecuta el intent con args ya validados. */
  execute(ctx: ToolContext, args: Args): Promise<ToolResult>
}
```

`FastPathInput` incluye: `{ text, today, timezone, history, lastRef, services }`.
`services` es necesario para que el fast-path de `schedule` pueda tokenizar el catálogo determinísticamente.

## API del registry

```ts
// Detección sin LLM
const hit = detectFastPath({ text, today, timezone, history, lastRef, services })
// hit: { capability, args } | null

// Ejecución por nombre (tanto desde fast-path como desde tool-call LLM)
const result = await executeByName(toolName, args, ctx)
// result: ToolResult — { success, result, data?, fallthroughToLLM? }

// Tool definitions para pasarlas al LLM
const tools: ToolDefinition[] = getToolDefinitions()

// Sets para checks rápidos
WRITE_CAPABILITIES: Set<string>   // {'smart_schedule','cancel_booking','reschedule_booking','create_client','delete_client'}
BYPASS_CAPABILITIES: Set<string>  // capabilities cuyo resultado se devuelve sin re-síntesis
```

## Fast paths con `fallthroughToLLM`

Un detector puede aceptar el turno pero, al ejecutar, descubrir que el cliente nombrado no existe en la DB. En ese caso devuelve `{ success: false, result, fallthroughToLLM: true }` y el `agent.ts` cae al path LLM (que tiene la lista completa de clientes en el prompt). Permite resolver casos como "STT escribió 'Lizvet' pero el cliente es 'Lisbeth'" sin sacrificar el camino rápido.

## Por qué bypass LLM en respuesta

Cuando la tool ejecutada es la única del turno y tiene `bypassLLM=true`, `agent.ts` devuelve el `result.result` **literal** al usuario, sin pasar por el LLM de síntesis. Razones:

1. **Eliminar alucinaciones de re-síntesis**: Llama 3.3-70B a veces reescribía el resultado y cambiaba números.
2. **Patrón estándar**: equivalente a `return_direct=True` de LangChain.
3. **Latencia**: corta un round-trip Groq de ~700ms.

## Lastref + notifications post-write

Cuando una capability `isWrite` retorna `success` + `data` (`voice-pipeline.ts:buildNotificationFromWrite`):
- Se construye `AppointmentNotification` con `eventId = buildAppointmentEventId(action, businessId, appointmentId, date, time)` — **determinístico**, no `crypto.randomUUID()`. Un reintento de QStash/LLM con los mismos datos produce el mismo `eventId`, y la constraint `UNIQUE` sobre `notifications.event_id` descarta el duplicado silenciosamente.
- Si el action fue `created` o `rescheduled`, se actualiza `lastRefCandidate` con el ID/cliente/servicio/fecha — esto permite que el siguiente turno entienda "cancélala" / "reagéndala" sin re-nombrar al cliente.
- Si fue `cancelled`, `lastRefCandidate = null` — la cita ya no existe.

## Añadir una nueva capability

1. Crear `capabilities/<intent>/{index.ts, tool.ts, [fast-path.ts]}`.
2. Implementar `ICapability`.
3. Añadir el import + entrada en el array de `capabilities/_shared/registry.ts`.

Cero cambios en `agent.ts`.

## Tests

Un test por fast-path detector en `__tests__/fast-path.test.ts` por capability:
- `cancel`, `delete-client`, `last-visit`, `list-appointments`, `reschedule`, `schedule`, `search-clients`.

Más tests centrales en `voice-worker/core/__tests__/`: `date-parser`, `time-parser`, `fuzzy`.
