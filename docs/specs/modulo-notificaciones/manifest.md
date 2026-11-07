# 📋 Manifiesto de Dominio: Módulo de Notificaciones

Este documento define el contrato inmutable del pipeline de notificaciones de Cronix. Este módulo es transversal: es consumido tanto por el runtime Next.js (server actions, webhooks de pago) como por el runtime Deno (Edge Functions del agente WhatsApp). Ambos runtimes siguen el mismo contrato lógico con implementaciones físicas distintas.

## 1. Principio Rector

El módulo de notificaciones **NO es una capa de transporte**. Es un **registro de eventos de negocio** con propagación multi-canal. La base de datos es la fuente de verdad; todos los canales secundarios son best-effort y fallan silenciosamente sin afectar el evento que los originó.

## 2. Contrato del Evento (`AppointmentEvent`)

Todo evento que ingrese al pipeline debe conformar la siguiente estructura:

```typescript
interface AppointmentEvent {
  eventId:      string   // ID determinista — ver §3
  type:         'appointment.created' | 'appointment.rescheduled' | 'appointment.cancelled'
              | 'appointment.reschedule_requested' | 'appointment.cancel_requested' // pedido sin confirmar (WA, operacion-canonica O3)
  businessId:   string   // UUID del tenant — obligatorio para aislamiento
  businessName: string
  clientName:   string
  serviceName:  string
  date:         string   // YYYY-MM-DD en zona horaria LOCAL del negocio
  time:         string   // HH:mm 24h en zona horaria LOCAL del negocio
  requestedDate?: string | null // solo *_requested: la nueva fecha pedida, si el cliente la dijo
  userId:       string   // 'whatsapp-agent' | UUID del usuario del dashboard
  channel:      'whatsapp' | 'phone' | 'voice' | 'dashboard'
  ownerActed?:  boolean  // el dueño hizo el cambio: no recibe WhatsApp de su propia acción
}
```

**Invariante crítica:** Las fechas/horas en el evento representan la zona horaria LOCAL del negocio, nunca UTC. La conversión de UTC → local ocurre ANTES de construir el evento.

## 3. Idempotencia por `eventId` Determinista

Todo evento se identifica por un ID determinista generado por `buildAppointmentEventId()`:

```
formato: {action}:{businessId}:{appointmentId}:{date}:{time}
ejemplo: "created:uuid-negocio:uuid-cita:2026-06-15:10:00"
```

`action` ∈ `created | rescheduled | cancelled | reschedule_requested | cancel_requested`. Las dos últimas (2026-10-24) avisan al dueño de un pedido de WhatsApp **antes** de que el cliente confirme; usan la fecha/hora **actual** de la cita, así todos los turnos del mismo pedido comparten un `eventId` y el dueño recibe un solo aviso. Tipo de la campana: `cancel_requested` → `warning`, `reschedule_requested` → `info`.

**Garantía:** El mismo evento lógico (misma acción + misma cita + misma fecha/hora) produce el mismo `eventId`. La columna `notifications.event_id` tiene restricción `UNIQUE`. Si QStash reintenta o el pipeline se ejecuta dos veces, la segunda inserción falla silenciosamente con `409 conflict` — ningún canal secundario se ejecuta.

**Regla de implementación:** El `buildAppointmentEventId()` está compartido entre los dos runtimes:
- Next.js: `lib/notifications/appointment-event-id.ts`
- Deno: `supabase/functions/_shared/notifications/event-id.ts`
Los dos archivos DEBEN producir output byte-idéntico para el mismo input.

## 4. Pipeline de Ejecución (4 canales en orden)

```
emitBookingEvent(event)
    │
    ├─ [Idempotency check] ¿event_id ya existe en notifications?
    │   └─ Sí → return (sin ruido, sin error)
    │
    ├─ Canal 1: DB (fuente de verdad)
    │   └─ INSERT en tabla `notifications` con business_id, title, content, type, event_id, metadata
    │   └─ Si falla → return (abortar pipeline; sin logs duplicados en Realtime/WA)
    │
    ├─ Canal 2: Supabase Realtime
    │   └─ broadcast en canal `notifications:{businessId}`
    │   └─ Falla silenciosamente — DB ya tiene el registro
    │
    ├─ Canal 3: WhatsApp al dueño
    │   └─ Requiere `businesses.phone` vinculado via VINCULAR-slug
    │   └─ Se omite si el número no está configurado
    │   └─ Orden: plantilla de eventos (`OWNER_EVENT_TEMPLATE`) → plantilla aprobada `daily_owner_summary` con los datos del evento → texto libre (solo entrega en ventana 24h)
    │   └─ Medido 2026-11-04: `owner_event_notification` no se puede enviar desde el número de producción (Meta `132001`: no existe en ese idioma o no está aprobada). Mientras tanto el aviso sale con el texto del resumen diario: "El resumen diario está listo: {{1}}. Detalles adicionales: {{2}}. Gracias." Trade-off propuesto por el agente y aceptado por el usuario: texto inexacto a cambio de entregar sin esperar a Meta. Medido con un número real: llegan las acciones de clientes y empleados, y ninguna del dueño
    │   └─ Nunca rompe el pipeline; la degradación va a Sentry: plantilla de eventos falló → `owner_wa_template_failed`, resumen también → `owner_wa_summary_failed`, texto también → `owner_wa_undelivered`
    │
    └─ Canal 4: Web Push al PWA del dueño
        └─ Llama a la edge function `push-notify` via HTTP interno con `x-internal-secret`
        └─ Falla silenciosamente
```

**Patrón de despacho:** Fire-and-forget con `void emitBookingEvent(event)`. El caller nunca espera el resultado. El booking ya fue committed antes de llamar al pipeline.

## 5. Implementaciones por Runtime

### Runtime Next.js (`lib/notifications/`)
- No tiene pipeline propio: `announceBookingEvent(action, appointmentId)` llama a la edge function `booking-event`, que lee la cita dentro del negocio de quien llama y ejecuta el `emitBookingEvent` de Deno. El navegador no aporta datos del aviso

### Runtime Deno (Edge Functions WhatsApp)
- `emitBookingEvent()` de `supabase/functions/_shared/notifications/emit-booking-event.ts` es el único pipeline: WhatsApp, línea telefónica, botón de voz y dashboard
- Cubierto por `__tests__/edge-functions/emit-booking-event-deno.test.ts`, que ejecuta el archivo Deno real
- Acceso a Supabase vía `createClient(url, serviceRoleKey)`

## 6. Tipos de Notificación en Base de Datos

| `type` en DB | Cuándo se usa |
|---|---|
| `'success'` | Cita creada, reagendada, pago confirmado |
| `'warning'` | Cita cancelada |
| `'info'` | Recordatorios, eventos de sistema |
| `'error'` | Fallos críticos que requieren atención del dueño |

## 7. Criterios de Aceptación

**AC-1 — Idempotencia:**
- DADO un evento con `eventId` ya existente en DB,
- CUANDO `emitBookingEvent` se llama una segunda vez con el mismo evento,
- ENTONCES el pipeline retorna sin insertar nada y sin ejecutar los canales 2-4.

**AC-2 — Fallo en canal 1 no propaga:**
- DADO un error de DB en el INSERT de la notificación,
- CUANDO `saveNotificationToDB` retorna `false`,
- ENTONCES los canales 2 (Realtime), 3 (WA dueño) y 4 (Web Push) NO se ejecutan.

**AC-3 — Fallo en canal 2-4 no bloquea booking:**
- DADO un fallo de red o timeout en Realtime, WA o Web Push,
- CUANDO el canal correspondiente falla,
- ENTONCES el pipeline continúa al siguiente canal y el error se registra en consola sin propagarse al caller.

## 8. Estado de entrega de cada WhatsApp (NORMATIVO)

- **Que Meta acepte un envío no es que llegue.** `appointment_reminders.status = 'sent'` significa solo que Meta aceptó el pedido. Lo que pasó después lo informa Meta por el webhook (`sent`, `delivered`, `read`, `failed` con código de error), y se guarda en `wa_message_status`.
- **`whatsapp-service`** devuelve `messageId` cuando Meta acepta y `errorCode` cuando rechaza. Si el pedido trae `track` (`businessId`, `purpose`: `client_reminder`, `owner_alert` u `owner_summary`, y `appointmentId` opcional), guarda a quién pertenece el mensaje.
- **`whatsapp-webhook`** registra cada evento de estado (`_shared/wa-delivery.ts`, `fn_record_wa_status`) después de verificar la firma de Meta. Un error al guardar se reporta a Sentry y nunca hace que Meta reintente.
- **El estado solo avanza** (`accepted` < `sent` < `failed` < `delivered` < `read`), porque Meta no garantiza el orden de sus eventos. Un estado que llega antes que el registro del envío crea la fila, y el envío después solo completa a quién pertenece.
- **Un recordatorio que Meta rechaza** guarda el código y el texto de Meta en `appointment_reminders.error_message`, y no un texto genérico.
- **Acceso:** solo `service_role` lee o escribe `wa_message_status` (RLS activo, sin políticas).
