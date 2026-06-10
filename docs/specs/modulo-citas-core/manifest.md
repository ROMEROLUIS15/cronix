# 📋 Manifiesto de Dominio: Módulo Core de Citas

Este documento define el contrato de los Use Cases de dominio para la gestión de citas en Cronix. Estos Use Cases son el núcleo de negocio: son agnósticos al canal (WhatsApp, Dashboard, API) y NUNCA conocen a Supabase, al LLM, ni a ningún framework de UI.

## 1. Principio de Capa

Los Use Cases de `lib/domain/use-cases/` son **Comandos con efectos secundarios** que:
- Dependen EXCLUSIVAMENTE de interfaces de repositorio (`IAppointmentQueryRepository`, `IAppointmentCommandRepository`)
- Nunca instancian clientes de base de datos directamente
- Siempre retornan `Result<T>` — jamás lanzan excepciones abiertas
- Reciben DTOs tipados — nunca argumentos crudos del LLM o del formulario

## 2. Máquina de Estados de una Cita

```
         Creación
            │
            ▼
        [pending]
            │
            ▼ (confirmación automática o manual)
        [confirmed]  ──────────────────┐
            │                         │
            ├──► [rescheduled]         │ (baja lógica)
            │         │               │
            │         └──► [cancelled]◄┘
            │
            └──► [completed]  (via cron/trigger, no por usuario)
```

**Invariantes:**
- `pending` → `confirmed`: siempre automático salvo configuración del negocio
- `cancelled` es **baja lógica** — el registro persiste en DB, el slot queda libre
- Solo citas en estado `confirmed` pueden ser `rescheduled` o `cancelled` por el bot
- `completed` es un estado terminal — no puede revertirse

## 3. Catálogo de Use Cases

### `CreateAppointmentUseCase`
**Entrada:** `{ businessId, clientId, serviceIds[], startAt, endAt, notes?, assignedUserId? }`
**Salida:** `Result<{ id, businessId, clientId, status }>`

Flujo:
1. `queryRepo.findConflicts(businessId, startAt, endAt)` → si hay conflicto → `fail('Ese horario ya está ocupado')`
2. `commandRepo.create({ ... status: 'pending' })` → si error DB → `fail(...)`
3. Retorna `ok({ id, businessId, clientId, status })`

**Regla crítica:** El Use Case NO dispara notificaciones. Las notificaciones son responsabilidad del orquestador que llama al Use Case (ej: server action, tool executor).

### `CancelAppointmentUseCase`
**Entrada:** `{ businessId, appointmentId }`
**Salida:** `Result<void>`

Flujo:
1. `commandRepo.updateStatus(appointmentId, 'cancelled', businessId)` → si error → `fail(...)`
2. Retorna `ok(undefined)`

**Regla de aislamiento:** El `businessId` es obligatorio para el `updateStatus`. El repositorio DEBE filtrar por `business_id` en la query de actualización — un tenant no puede cancelar citas de otro.

### `RescheduleAppointmentUseCase`
**Entrada:** `{ businessId, appointmentId, newStartAt, newEndAt }`
**Salida:** `Result<void>`

Flujo:
1. `queryRepo.findConflicts(businessId, newStartAt, newEndAt, appointmentId)` → el `appointmentId` se excluye del chequeo para no conflictuar consigo mismo
2. Si hay conflicto → `fail('El nuevo horario ya está ocupado')`
3. `commandRepo.reschedule(appointmentId, newStartAt, newEndAt, businessId)` → si error → `fail(...)`
4. Retorna `ok(undefined)`

### `GetAvailableSlotsUseCase`
**Entrada:** `{ businessId, date, durationMin, workingHours?, slotIntervalMin }`
**Salida:** `Result<AvailableSlot[]>` donde `AvailableSlot = { time: string (HH:mm), label: string }`

Reglas de disponibilidad:
- Horario por defecto si el negocio no configuró: 09:00 - 18:00
- Un slot es libre si su duración completa (`durationMin`) cabe antes del inicio del siguiente booking
- Granularidad de slots: `slotIntervalMin` minutos (default 30)
- Las fechas de los bookings existentes vienen en UTC — el Use Case trabaja en el timezone del negocio (el llamador debe pre-convertir)

### `CompleteAppointmentUseCase`
**Cuándo:** Disparado por un cron job o trigger, NO por acción del usuario
**Entrada:** `{ appointmentId, businessId }`
**Salida:** `Result<void>`
**Nota:** Pasa el estado a `completed`. Es un estado terminal.

### `GetAppointmentsByDateUseCase`
**Entrada:** `{ businessId, date, timezone }`
**Salida:** `Result<AppointmentSummary[]>` donde `AppointmentSummary = { id, time, clientName, serviceName, status }`

### `RegisterPaymentUseCase`
**Entrada:** `{ businessId, appointmentId, amount, method, notes? }`
**Salida:** `Result<void>`
**Nota:** Registra un pago manual (efectivo, transferencia). Distinto al flujo de `lib/payments/` que es para suscripciones SaaS.

## 4. Contratos de Repositorio (Interfaces)

Los Use Cases dependen de estas interfaces — NUNCA de la implementación concreta Supabase:

```typescript
interface IAppointmentQueryRepository {
  findConflicts(businessId, startAt, endAt, excludeId?): Promise<Result<Conflict[]>>
  getDaySlots(businessId, dayStart, dayEnd): Promise<Result<SlotRow[]>>
}

interface IAppointmentCommandRepository {
  create(data): Promise<Result<AppointmentRow>>
  updateStatus(appointmentId, status, businessId): Promise<Result<void>>
  reschedule(appointmentId, newStartAt, newEndAt, businessId): Promise<Result<void>>
}
```

## 5. Criterios de Aceptación

**AC-1 — Conflicto de slot bloquea creación:**
- DADO un slot ocupado entre 10:00 y 11:00,
- CUANDO `CreateAppointmentUseCase.execute` recibe `startAt=10:30, endAt=11:30`,
- ENTONCES retorna `fail('Ese horario ya está ocupado')` sin insertar en DB.

**AC-2 — Reagendamiento excluye su propia cita del conflicto:**
- DADO una cita existente de 10:00 a 11:00,
- CUANDO `RescheduleAppointmentUseCase.execute` reagenda esa misma cita a 10:30,
- ENTONCES `findConflicts` excluye el `appointmentId` actual y no retorna conflicto.

**AC-3 — Aislamiento de tenant:**
- DADO un `updateStatus` o `reschedule`,
- CUANDO el repositorio ejecuta la query,
- ENTONCES la query DEBE incluir `.eq('business_id', businessId)` — no puede modificar citas de otro tenant.
