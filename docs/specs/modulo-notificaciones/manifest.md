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
  businessId:   string   // UUID del tenant — obligatorio para aislamiento
  businessName: string
  clientName:   string
  serviceName:  string
  date:         string   // YYYY-MM-DD en zona horaria LOCAL del negocio
  time:         string   // HH:mm 24h en zona horaria LOCAL del negocio
  userId:       string   // 'whatsapp-agent' | UUID del usuario del dashboard
  channel:      'whatsapp' | 'dashboard' | 'system'
}
```

**Invariante crítica:** Las fechas/horas en el evento representan la zona horaria LOCAL del negocio, nunca UTC. La conversión de UTC → local ocurre ANTES de construir el evento.

## 3. Idempotencia por `eventId` Determinista

Todo evento se identifica por un ID determinista generado por `buildAppointmentEventId()`:

```
formato: {action}:{businessId}:{appointmentId}:{date}:{time}
ejemplo: "created:uuid-negocio:uuid-cita:2026-06-15:10:00"
```

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
    │   └─ Falla silenciosamente si el número no está configurado
    │
    └─ Canal 4: Web Push al PWA del dueño
        └─ Llama a la edge function `push-notify` via HTTP interno con `x-internal-secret`
        └─ Falla silenciosamente
```

**Patrón de despacho:** Fire-and-forget con `void emitBookingEvent(event)`. El caller nunca espera el resultado. El booking ya fue committed antes de llamar al pipeline.

## 5. Implementaciones por Runtime

### Runtime Next.js (`lib/application/` o server actions)
- Usa `NotificationService` inyectado desde `lib/container.ts`
- Retorna `Result<void>` como contrato de error
- Acceso a Supabase Admin vía cliente del servidor

### Runtime Deno (Edge Functions WhatsApp)
- Usa `emitBookingEvent()` de `supabase/functions/process-whatsapp/notifications.ts`
- No puede importar módulos Next.js — implementación espejo del mismo contrato
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
