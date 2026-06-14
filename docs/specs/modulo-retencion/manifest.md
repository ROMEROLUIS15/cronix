# 📋 Manifiesto de Dominio: Módulo de Retención y Reenganche de Clientes

> **Estado:** 🟡 Spec de diseño — feature en construcción (sprint 2). Alineado con
> la realidad del código (infra WhatsApp saliente, cron y esquema verificados
> 2026-06-13). Define el alcance **v1**; lo diferido a v2 está marcado.

Define el contrato de negocio y técnico para detectar clientes inactivos y
**reengancharlos automáticamente** por WhatsApp. La filosofía es **manos fuera**:
el dueño enciende el módulo una vez y el agente trabaja solo por él 24/7.

---

## 1. Propósito

Mantener la agenda llena: un proceso automático (cron) detecta clientes que
superaron su frecuencia de visita sin reservar de nuevo y les envía un mensaje
de reenganche por WhatsApp, **sin intervención manual del dueño**. La detección
es determinista (SQL), no un juicio de LLM.

---

## 2. Invariantes de Negocio (Reglas de Oro)

* **Aislamiento Multi-Tenant:** toda consulta/envío filtra por `business_id`
  (constitution §4).
* **Automático por defecto del flujo, consentimiento por toggle:** el reenganche
  lo dispara un **cron**, no el dueño. El único acto manual es **encender el
  módulo una vez** (`settings.retention.enabled`, default **OFF**). Encendido ⇒
  manos fuera: el agente reengancha solo. El toggle es consentimiento + el
  interruptor de pánico, no trabajo recurrente.
* **Plantilla Meta obligatoria fuera de la ventana de 24h (CRÍTICO):** el cliente
  inactivo está fuera de la sesión de 24h de WhatsApp ⇒ el mensaje DEBE ir con
  **plantilla Meta aprobada (HSM)**, nunca texto libre. Infra ya existe
  (`whatsapp-service` `type:"template"`; lo usa `cron-reminders`).
* **Anti-Spam (frecuencia de contacto):** no se reenvía a un cliente con
  `clients.last_reengaged_at` dentro de los últimos `antiSpamDays` (default 30).
* **Tope diario por negocio (anti-baneo):** máximo `dailyCap` envíos por negocio
  por corrida (`settings.retention.dailyCap`, default p.ej. 50). Sin esto, un
  negocio con cientos de inactivos haría un disparo masivo que Meta marca como
  spam y degrada/banea el número — y ahí se cae TODO, no solo retención.
* **Opt-out obligatorio:** si el cliente responde para no recibir más (STOP/"no
  me escriban"/etc.), se marca `clients.retention_opted_out` y queda excluido
  para siempre. Exigencia de Meta para mensajes de categoría marketing.
* **Excluir citas futuras:** cliente con cita futura activa (`pending`/`confirmed`,
  `start_at > now()`) nunca es candidato — ya va a volver.
* **Solo visita previa real (v1):** candidato = ≥1 cita `completed` pasada y
  superó la frecuencia. "Nunca vinieron" (lead nurture) queda fuera de v1.
* **Canal único:** WhatsApp por el número oficial del negocio.
* **Invalidación de caché cross-canal:** el cron toca `clients.last_reengaged_at`
  ⇒ DEBE invalidar el caché del dashboard vía el seam compartido
  `_shared/cache-invalidation.ts` (modulo-voice-agent §8).
* **Idempotencia:** una corrida del cron no debe re-enviar a un cliente ya
  contactado en la misma ventana (garantizado por `last_reengaged_at` + el
  filtro anti-spam dentro del RPC).

---

## 3. Modelo de Datos (Esquema SQL)

> Verificado 2026-06-13. `clients.last_visit_at`, `clients.phone`,
> `businesses.timezone`, `businesses.settings` (jsonb), `services.duration_min`
> YA existen.

### Aplicado (migración `20260613150000_retention_v1`)
1. **`businesses.default_attendance_frequency_days`** `int NOT NULL DEFAULT 30`.
2. **`clients.last_reengaged_at`** `timestamptz NULL` (guard anti-spam).
3. **RPC `get_reengageable_clients_rpc(biz_id, frequency_days, antispam_days)`** —
   candidatos deterministas (completada pasada > freq, sin cita futura activa,
   fuera de anti-spam, con teléfono, no borrado). Validado en prod.

### Pendiente de migración (fase opt-out)
4. **`clients.retention_opted_out`** `boolean NOT NULL DEFAULT false`. El RPC
   sumará `and not c.retention_opted_out` cuando exista.

### Config en `businesses.settings` (jsonb — sin columna nueva)
- `settings.retention.enabled` (bool, default false) — el toggle.
- `settings.retention.dailyCap` (int, default 50) — tope por corrida.
- La frecuencia vive en la columna `default_attendance_frequency_days`.

### v2 — diferido
- `services.recommended_return_days` y `clients.attendance_frequency_days`
  (frecuencia por-servicio / por-cliente con precedencia). En v1 la frecuencia
  es única por negocio.

---

## 4. Casos de Uso

> Capa: `lib/domain/use-cases/retention/` (orquestación, dependen de interfaces).

### `GetEligibleClientsUseCase`
* **Entrada:** `{ businessId }`
* **Salida:** `Result<EligibleClient[]>` con `{ id, name, phone, lastCompletedAt }`
* **Flujo:** lee `default_attendance_frequency_days` + `antiSpamDays` y delega a
  `IClientRepository.findInactiveByFrequency(...)` (RPC determinista). Excluye
  opted-out.

### `ProcessRetentionUseCase` (orquestación del cron)
* **Entrada:** `{ businessId }` (el cron itera negocios con `retention.enabled`).
* **Salida:** `Result<{ sent: number; failed: number; capped: boolean }>`
* **Flujo:**
  1. Si `settings.retention.enabled !== true` → no-op.
  2. `GetEligibleClientsUseCase` → candidatos.
  3. Tomar hasta `dailyCap`.
  4. Por cada uno: enviar plantilla `client_winback` vía `whatsapp-service`
     (`type:"template"`, params nombre + negocio).
  5. En cada envío OK: `updateLastReengaged(clientId, businessId)`.
  6. Invalidar caché del dashboard (seam compartido).
  7. Devolver métricas.

> **Supersede** `get_inactive_clients_rpc` (60d fijo, LIMIT 5, sin anti-spam/
> futuras). Sin callers en la app (verificado) → se deja morir.

---

## 5. Contrato de Persistencia (Repositorio)

```typescript
interface IClientRepository {
  // ...

  /** Clientes elegibles para reenganche (frecuencia + anti-spam + no opt-out). */
  findInactiveByFrequency(
    businessId: string, frequencyDays: number, antiSpamDays: number,
  ): Promise<Result<EligibleClientRow[]>>

  /** Marca el último reenganche (anti-spam). Invalida caché. */
  updateLastReengaged(clientId: string, businessId: string): Promise<Result<void>>

  /** Marca opt-out permanente (desde el handler de WhatsApp entrante). */
  setRetentionOptOut(clientPhone: string, businessId: string): Promise<Result<void>>
}
```

---

## 6. Disparador: Cron (espejo de `cron-reminders`)

* Edge Function nueva `cron-retention` (o tarea dentro del cron horario),
  disparada por **pg_cron**, autenticada con `CRON_SECRET` (server-to-server).
* Itera negocios con `settings.retention.enabled = true`; por cada uno corre
  `ProcessRetentionUseCase`. Misma estructura modular que `cron-reminders`
  (fetcher / sender / db), Sentry, idempotencia.
* Cadencia recomendada: **1×/día** a una hora local razonable (no de madrugada),
  reutilizando el patrón de "hora local del negocio".

---

## 7. Canal WhatsApp — Plantilla Meta

* **Nombre:** `client_winback` · **Categoría:** `MARKETING` · **Idioma:** `es`.
* **Body:** `Hola {{1}} 👋, en {{2}} te extrañamos. ¿Te gustaría agendar tu
  próxima cita? Responde a este mensaje y con gusto te ayudamos.`
  - `{{1}}` nombre del cliente · `{{2}}` nombre del negocio.
* Hasta que Meta apruebe, el cron NO envía (sin fallback a texto libre fuera de
  24h). El desarrollo procede en paralelo.

---

## 8. Opt-out (entrante)

El handler de WhatsApp entrante (`process-whatsapp`) detecta intención de baja
(STOP / "no me escriban" / "ya no quiero mensajes") y llama
`setRetentionOptOut(phone, businessId)`. El RPC de candidatos excluye opted-out.
Confirmar al cliente ("listo, no te escribiremos más"). Detección por keywords
deterministas, sin LLM en el camino crítico.

---

## 9. Criterios de Aceptación

* **AC-1 — Detección:** cliente con `completed` pasada > frecuencia y sin cita
  futura → elegible.
* **AC-2 — Excluido por cita futura activa** → no elegible.
* **AC-3 — Anti-spam:** `last_reengaged_at` < `antiSpamDays` → no elegible.
* **AC-4 — Sin teléfono** → no elegible.
* **AC-5 — Toggle OFF:** `ProcessRetentionUseCase` con `retention.enabled=false`
  → no-op, 0 envíos.
* **AC-6 — Tope diario:** candidatos > `dailyCap` → se envían exactamente
  `dailyCap`, `capped=true`; el resto entra en la siguiente corrida.
* **AC-7 — Envío marca anti-spam:** envío OK → `last_reengaged_at = now()`.
* **AC-8 — Opt-out:** cliente que pidió baja → nunca elegible.
* **AC-9 — Plantilla obligatoria:** envío con `type:"template"`, nunca texto libre.
* **AC-10 — Tenant:** todo opera scoped por `business_id`.

---

## 10. Plan por Fases (cada fase aislada y testeable)

1. ✅ **Migración v1** (columnas + RPC) — aplicada y validada en prod.
2. **Repo + interfaz:** `findInactiveByFrequency`, `updateLastReengaged`,
   `setRetentionOptOut` (+ tests).
3. **Use-cases:** `GetEligibleClientsUseCase`, `ProcessRetentionUseCase` (+ tests
   con repos mock; cubrir toggle OFF, cap, anti-spam).
4. **Cron `cron-retention`** + registro pg_cron (espejo de `cron-reminders`).
5. **Opt-out:** migración `clients.retention_opted_out` + actualización del RPC +
   detección en `process-whatsapp`.
6. **Dashboard:** toggle de retención + frecuencia + tope (Settings) y, opcional,
   panel de "clientes reenganchados".
7. **Plantilla Meta** `client_winback` (trámite externo, en paralelo desde ya).
8. **v2:** frecuencia por-servicio/por-cliente, log de auditoría, métricas.
