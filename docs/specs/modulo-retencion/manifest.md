# 📋 Manifiesto de Dominio: Módulo de Retención y Reenganche de Clientes

> **Estado:** 🟡 Spec de diseño — feature en construcción (sprint 2). Esta versión
> está alineada con la realidad del código (infra de WhatsApp saliente, cron y
> esquema verificados el 2026-06-13). Define el alcance **v1**; lo diferido a v2
> está marcado explícitamente.

Define el contrato de negocio y las especificaciones técnicas para identificar
clientes inactivos y reenganchar­los por WhatsApp en Cronix.

---

## 1. Propósito

Mantener la agenda llena detectando clientes que superaron su frecuencia
habitual de visita sin reservar de nuevo, y permitir al **dueño** enviarles un
mensaje de reenganche por WhatsApp. La IA NO está en el camino crítico: la
detección es una consulta determinista (SQL), no un juicio de LLM.

---

## 2. Invariantes de Negocio (Reglas de Oro)

* **Aislamiento Multi-Tenant:** toda consulta/envío filtra por `business_id`
  (constitution §4). Un tenant nunca ve clientes ni agenda de otro.
* **Plantilla Meta obligatoria fuera de la ventana de 24h (CRÍTICO):** un cliente
  inactivo está, por definición, fuera de la ventana de sesión de 24h de
  WhatsApp. El mensaje de reenganche DEBE enviarse con una **plantilla Meta
  aprobada (HSM)**, nunca texto libre. La infra ya existe (`whatsapp-service`
  acepta `type:"template"`; lo usa `cron-reminders` para el resumen del dueño).
  El texto libre solo es válido dentro de la ventana de 24h y NO aplica aquí.
* **Dueño-en-el-loop (decisión de producto v1):** el sistema **detecta y propone**
  candidatos; el **dueño revisa y dispara** el envío (selección de `clientIds`).
  NO hay envío 100% automático en v1 — protege la reputación del número de
  WhatsApp y da control sobre tono/momento. El modo automático (cron) queda para
  v2 detrás de un toggle por negocio.
* **Anti-Spam (frecuencia de contacto):** no se reenvía a un cliente que ya
  recibió un reenganche en los últimos `antiSpamDays` (default 30), controlado
  por `clients.last_reengaged_at`.
* **Excluir citas futuras:** un cliente con una cita futura activa
  (`pending`/`confirmed`, `start_at > now()`) NUNCA es candidato — ya va a volver.
* **Solo clientes con visita previa real (v1):** candidato = tuvo al menos una
  cita `completed` pasada y superó la frecuencia. Los "nunca vinieron" (lead
  nurture) quedan fuera de v1.
* **Canal único:** WhatsApp por el número oficial del negocio.
* **Invalidación de caché cross-canal:** todo write que toque `clients`
  (p.ej. `last_reengaged_at`) desde una Edge Function DEBE invalidar el caché del
  dashboard vía el seam compartido `_shared/cache-invalidation.ts` (ver
  modulo-voice-agent §8). No repetir el bug de "lo cambio y el dashboard no lo ve".

---

## 3. Modelo de Datos (Esquema SQL)

> Verificado 2026-06-13: **ninguna** de estas columnas existe aún. Todas son
> migración nueva. `clients.last_visit_at`, `clients.phone`, `businesses.timezone`
> y `services.duration_min` SÍ existen y se reutilizan.

### v1 — migración requerida (mínima)

1. **`public.businesses.default_attendance_frequency_days`** — `int NOT NULL
   DEFAULT 30`. Frecuencia estándar de visita del negocio, configurable desde la
   UI al activar el módulo de retención.
2. **`public.clients.last_reengaged_at`** — `timestamptz NULL`. Marca del último
   WhatsApp de reenganche enviado (guard anti-spam).

### v2 — diferido (NO en v1)

3. `public.services.recommended_return_days` — `int NULL`. Ciclo recomendado por
   servicio (10 barbería, 21 pestañas, 30 médico…). Habilita frecuencia
   por-servicio cuando escale a multi-vertical.
4. `public.clients.attendance_frequency_days` — `int NULL`. Override por cliente
   VIP/especial.

La **precedencia de frecuencia** (cliente → servicio → negocio) es de v2. En v1
la frecuencia es **única por negocio** (`default_attendance_frequency_days`).

---

## 4. Casos de Uso

> Capa: `lib/domain/use-cases/retention/` (orquestación con efectos, dependen de
> interfaces — constitution §1). Validaciones puras → `lib/use-cases/` si aplica.

### `GetInactiveClientsUseCase`
* **Entrada:** `{ businessId }`
* **Salida:** `Result<InactiveClient[]>` con
  `InactiveClient = { id, name, phone, lastVisitAt, lastCompletedAt }`
* **Flujo (v1):**
  1. Leer `businesses.default_attendance_frequency_days` (y `antiSpamDays`=30).
  2. Delegar a `IClientRepository.findInactiveByFrequency(businessId, freq, antiSpam)`
     — RPC determinista `get_reengageable_clients_rpc` que aplica: última cita
     `completed` < hoy − freq; sin cita futura activa; `last_reengaged_at` nulo o
     > antiSpam; con teléfono; `deleted_at` nulo. Orden por más-antiguo primero.

### `SendReengagementMessagesUseCase`
* **Entrada:** `{ businessId, clientIds[] }`
* **Salida:** `Result<{ sentCount: number; failed: ClientId[] }>`
* **Flujo (v1):**
  1. Validar que cada `clientId` pertenece a `businessId` Y sigue siendo
     candidato (re-chequear anti-spam/cita-futura para evitar carreras).
  2. Por cada cliente, enviar la **plantilla Meta** `client_winback` vía
     `whatsapp-service` (`type:"template"`).
  3. En cada envío exitoso, `updateLastReengaged(clientId, businessId)`.
  4. Invalidar caché del dashboard (seam compartido).
  5. Devolver enviados + fallidos.

> **Supersede:** `get_inactive_clients_rpc` (60 días fijo, LIMIT 5, sin
> anti-spam, sin excluir futuras) queda obsoleto. Sin callers en la app
> (verificado) → no se elimina por ahora, se deja morir; el nuevo RPC lo reemplaza.

---

## 5. Contrato de Persistencia (Repositorio)

Extensión de `IClientRepository`:

```typescript
interface IClientRepository {
  // ... métodos existentes

  /** Clientes elegibles para reenganche según frecuencia + anti-spam. */
  findInactiveByFrequency(
    businessId:   string,
    frequencyDays: number,
    antiSpamDays:  number,
  ): Promise<Result<InactiveClientRow[]>>

  /** Marca el último reenganche (guard anti-spam). Invalida caché. */
  updateLastReengaged(clientId: string, businessId: string): Promise<Result<void>>
}
```

---

## 6. Canal WhatsApp — Plantilla Meta

* **Nombre sugerido:** `client_winback` · **Categoría Meta:** `MARKETING` ·
  **Idioma:** `es`.
* **Body (con parámetros):**
  `Hola {{1}} 👋, en {{2}} te extrañamos. ¿Te gustaría agendar tu próxima cita?
  Responde a este mensaje y con gusto te ayudamos.`
  - `{{1}}` = nombre del cliente · `{{2}}` = nombre del negocio.
* **Restricción:** hasta que Meta apruebe la plantilla, el feature NO puede
  enviar (no hay fallback a texto libre fuera de la ventana de 24h). El
  desarrollo procede en paralelo a la aprobación.
* **Cumplimiento:** categoría MARKETING implica que el cliente puede recibir
  límites de frecuencia de Meta; el guard `last_reengaged_at` (30 días) ayuda a
  no saturar.

---

## 7. Criterios de Aceptación

* **AC-1 — Inactivo detectado:** DADO un cliente con última cita `completed` hace
  > `default_attendance_frequency_days` y sin cita futura activa, CUANDO corre
  `GetInactiveClientsUseCase`, ENTONCES aparece en la lista.
* **AC-2 — Excluido por cita futura:** DADO un cliente inactivo pero con cita
  `confirmed` futura, ENTONCES NO aparece.
* **AC-3 — Anti-spam:** DADO un candidato con `last_reengaged_at` hace < 30 días,
  ENTONCES NO aparece.
* **AC-4 — Sin teléfono:** DADO un candidato sin `phone`, ENTONCES NO aparece
  (no se puede contactar).
* **AC-5 — Envío marca anti-spam:** DADO un envío exitoso, ENTONCES
  `last_reengaged_at` se setea a `now()` y el cliente deja de ser candidato.
* **AC-6 — Tenant:** `SendReengagementMessagesUseCase` rechaza `clientIds` que no
  pertenecen al `businessId`.
* **AC-7 — Plantilla obligatoria:** el envío usa `type:"template"`; nunca texto
  libre.

---

## 8. Plan por Fases (cada fase aislada y testeable)

1. **Migración** (v1 columns) + **RPC** `get_reengageable_clients_rpc`. ← foundation
2. **Repo + interfaz:** `findInactiveByFrequency`, `updateLastReengaged` (+ tests).
3. **Use-cases** de dominio (+ tests con repos mock).
4. **Superficie dashboard:** lista de candidatos + acción de envío (server action)
   + toggle/modal de `default_attendance_frequency_days`.
5. **Plantilla Meta** `client_winback` (trámite externo, en paralelo desde fase 1).
6. **v2 (futuro):** frecuencia por-servicio/por-cliente, modo automático (cron +
   toggle), log de auditoría de envíos.
