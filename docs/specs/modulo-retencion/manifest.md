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
* **Solo planes Pro+ (`pro` / `enterprise`):** el módulo NO está disponible en
  `free`. Doble propósito: monetización (feature premium de alto valor) y
  **anti-spam/reputación** — restringir a cuentas de pago reduce el riesgo de que
  Meta degrade el número compartido por envíos de baja calidad. Se aplica en DOS
  puntos: el cron/`ProcessRetentionUseCase` salta negocios no-Pro+, y el dashboard
  muestra el toggle bloqueado con upsell. Helper `canAccessRetention(plan)` en
  `lib/plans/plan-limits.ts` (espejo de `canAccessReports`).
* **Plantilla Meta obligatoria fuera de la ventana de 24h (CRÍTICO):** el cliente
  inactivo está fuera de la sesión de 24h de WhatsApp ⇒ el mensaje DEBE ir con
  **plantilla Meta aprobada (HSM)**, nunca texto libre. Infra ya existe
  (`whatsapp-service` `type:"template"`; lo usa `cron-reminders`).
* **El número del dueño manda (NORMATIVO, decidido por el dueño del producto el
  2026-11-22):** el dueño elige **N días** (1 a 365, sin valor por defecto). Recibe
  el mensaje cada cliente cuya última visita fue hace más de N días. **No hay
  ningún número fijo:** el 30 de antes era de las pruebas.
* **Repetición:** a un cliente que recibió el mensaje y sigue sin volver se le
  vuelve a escribir cuando pasan **otra vez N días** (`clients.last_reengaged_at`;
  el use case pasa N como `antispam_days`).
* **Topes diarios de la plataforma (NORMATIVO, 2026-11-22; enfoque A):** iguales
  para todos los negocios, sin configuración por negocio (`RETENTION_LIMITS`):
  - **3 mensajes por negocio por día.** Un negocio atiende pocas citas por día
    (RS STUDIO: ~1,1 por día en 180 días, medido), así que mandar más no se
    convierte en reservas.
  - **37 mensajes por día en toda la plataforma** = 15 % de las 250 conversaciones
    iniciadas por la empresa que Meta permite cada 24 h al **número compartido**
    mientras la empresa no esté verificada. El 85 % queda para recordatorios y
    avisos al dueño, que nunca se frenan.
  - **Reparto:** los negocios se recorren en un orden que rota cada día
    (`lib/use-cases/retention-order.ts`); al agotarse los 37, los restantes
    esperan al día siguiente (`skipped` en la respuesta del cron). Ningún
    cliente se pierde: sigue elegible.
  - Un `settings.retention.dailyCap` guardado por versiones anteriores se ignora, y
    Ajustes ya no lo escribe (guarda solo `enabled`).
  - **Siguiente paso (enfoque B, decidido):** tope por capacidad (turnos libres de
    los próximos días), calibrado con la conversión real medida con el enfoque A.
* **Opt-out obligatorio:** si el cliente responde para no recibir más (STOP/"no
  me escriban"/etc.), se marca `clients.retention_opted_out` y queda excluido
  para siempre. Exigencia de Meta para mensajes de categoría marketing.
* **Excluir citas futuras:** cliente con cita futura activa (`pending`/`confirmed`,
  `start_at > now()`) nunca es candidato — ya va a volver.
* **Qué es una visita (NORMATIVO, 2026-11-22):** toda cita **pasada** que no esté
  `cancelled` ni `no_show`. Si llegó el día y no se canceló, el cliente fue
  atendido: los dueños no cierran cada cita a mano. Antes contaba solo
  `completed`, y como el dashboard pasa a `completed` las citas vencidas recién
  cuando el dueño lo abre, quién recibía el mensaje dependía de eso (medido en
  local: el mismo cliente salía o no según si se abrió el dashboard). Un cliente sin
  ninguna visita ("nunca vinieron") queda fuera.
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
   candidatos deterministas (última visita hace más de `frequency_days`, sin cita
   futura activa, sin mensaje en los últimos `antispam_days`, con teléfono, no
   borrado). La columna de salida `last_completed_at` conserva el nombre y guarda
   la última visita. Desde la migración `20261122130000`: visita = cita pasada no
   `cancelled` ni `no_show`, y **solo `service_role` la puede ejecutar** (era
   `SECURITY DEFINER`, recibía cualquier `biz_id`, devolvía nombres y teléfonos y la
   podía llamar cualquier usuario con sesión; su único uso es el cron).

### Aplicado (migración `20260614_retention_optout`)
4. ✅ **`clients.retention_opted_out`** `boolean NOT NULL DEFAULT false`. El RPC
   `get_reengageable_clients_rpc` ya incluye `and not c.retention_opted_out`.

### Config en `businesses.settings` (jsonb — sin columna nueva)
- `settings.retention.enabled` (bool, default false) — el toggle.
- No hay tope por negocio en la configuración: los topes son de la plataforma (§2).
- La frecuencia vive en la columna `default_attendance_frequency_days`.

### UX de activación (v1 — modal al encender el switch)
Al poner el toggle en ON, se abre un **modal** que pide **un número de días**
("¿Cada cuántos días reenganchamos a un cliente que no vuelve?"). **El campo arranca
vacío** y "Activar" queda deshabilitado hasta que haya un número entero de 1 a 365
(`lib/use-cases/retention-days.ts`); si el negocio ya había configurado el
reenganche, muestra su número. Escribe en `default_attendance_frequency_days`. El
`DEFAULT 30` de esa columna no cuenta como elección del dueño: solo vale una vez que
el reenganche fue configurado (existe `settings.retention`). Confirmar el modal persiste
`settings.retention.enabled = true` + la frecuencia; cancelar deja el switch OFF.
Un solo número, a nivel negocio. El **ajuste por servicio** (cada servicio con su
propio ciclo, que sobrescribe este global) es **v2** — este número queda como el
piso por defecto, no se descarta.

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
* **Flujo:** lee `default_attendance_frequency_days` (N) y lo pasa dos veces, como
  días sin visita y como espera para repetir, a
  `IClientRepository.findInactiveByFrequency(...)` (RPC determinista). Excluye
  opted-out.

### `ProcessRetentionUseCase` (orquestación del cron)
* **Entrada:** `{ businessId }` (el cron itera negocios con `retention.enabled`).
* **Salida:** `Result<{ sent: number; failed: number; capped: boolean; aborted?: WinbackFailure }>`
  (`aborted` solo existe si la corrida se cortó por un fallo de plataforma, §7.1).
* **Flujo:**
  1. Si `settings.retention.enabled !== true` → no-op.
  2. `GetEligibleClientsUseCase` → candidatos.
  3. Tomar hasta 3 (tope por negocio), o menos si al presupuesto de la plataforma
     le queda menos (`maxSends`, lo pasa el cron).
  4. Por cada uno: enviar plantilla `client_winback` vía `whatsapp-service`
     (`type:"template"`, params nombre + negocio). Si el envío falla con alcance
     **plataforma**, la corrida se corta ahí (§7.1); con alcance **destinatario**
     se cuenta en `failed` y sigue.
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

  /** Marca opt-out permanente (desde el handler de WhatsApp entrante). [Fase 5] */
  setRetentionOptOut(clientPhone: string, businessId: string): Promise<Result<void>>
}
```

> **Estado de implementación:** `findInactiveByFrequency`, `updateLastReengaged`
> (Fase 2) y `setRetentionOptOut` (Fase 5) implementados y testeados en
> `IClientRepository` / `SupabaseClientRepository`. `setRetentionOptOut` matchea
> por `phone_digits` normalizado dentro del negocio e invalida caché.

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
* Sin fallback a texto libre fuera de 24h. Mientras Meta no apruebe la plantilla,
  el cron **no manda nada**: el primer envío recibe el error de plantilla y la
  corrida se corta (§7.1). Antes de 2026-11-20 esto no era así: el código
  intentaba todos los envíos aunque la plantilla no existiera (medido el
  2026-11-20: 50 llamadas a `whatsapp-service` en 15 s, el tope diario).

### 7.1 Fallos de envío (NORMATIVO)

Un fallo de envío tiene **alcance**: `platform` (se repetirá con todos los clientes:
plantilla, cuenta o número) o `recipient` (solo ese teléfono).

* **`platform` → la corrida del negocio se corta** en el primer fallo: no se envía a
  los siguientes, no se sella `last_reengaged_at` de nadie por ese intento, y el
  resultado trae `aborted` con `scope`, `code`, `template` y `message`. Lo ya
  enviado antes del corte se conserva.
* **`recipient` → se cuenta en `failed` y la corrida sigue.**
* **La ruta `/api/cron/retention`**, ante un `aborted`, **detiene el recorrido de
  negocios** (todos comparten plantilla y número), reporta **un** evento a Sentry
  (`logger.error('retention', …)`, mensaje constante, detalle `businessId`, `code`,
  `template`, `message`; sin datos de clientes) y responde **HTTP 502** con
  `ok:false`.
* **Clasificación** (`lib/services/whatsapp-error-codes.ts`, códigos de la
  referencia de Meta verificada 2026-11-20): `platform` = 132000, 132001, 132005,
  132007, 132012, 132015, 132016 (plantilla), 131042 (pago), 131048 (restricción del
  número), 130429 (throughput), 190 (token). Todo lo demás —131049, 131050, 131026,
  131047, 131056, un código desconocido o la ausencia de código— es `recipient`.
* **Trade-offs** (agente + usuario, 2026-11-20): (a) el puerto
  `IRetentionMessenger` devuelve una unión discriminada y no `Result<void>`, porque
  `Result` solo lleva un string y no puede decir si el fallo corta la corrida;
  (b) 131048 se trata como `platform` aunque la referencia lo describe también por
  destinatario: seguir enviando desde un número restringido empeora la restricción;
  (c) un fallo **sin código** (p. ej. `CRON_SECRET` sin configurar) sigue siendo
  `recipient`, es decir, sin corte: queda como seguimiento.

### 7.2 Entrega de cada mensaje

* Cada envío manda `track` (`businessId`, `purpose: 'client_winback'`, `clientId`) y
  `whatsapp-service` lo guarda en `wa_message_status`: lo que Meta informe después
  (`delivered`, `read`, `failed` con código) queda con su negocio y su cliente
  (modulo-notificaciones §8).
* **Medido en la primera corrida real (2026-11-22, 14:00 UTC, tope 5), antes de este
  cambio:** 5 llamadas con HTTP 200, 5 clientes estampados, 0 eventos en Sentry; y 5
  filas sin dueño en `wa_message_status` (4 `delivered` entre las 14:00:18 y las
  14:01:33, 1 `read` a las 14:35:41, 0 `failed`). Que esas 5 filas son los win-back se
  deduce del número y la hora, no se pudo enlazar: el envío no guardaba el `wamid`.
* **Orden de despliegue:** migración en producción → `whatsapp-service` → app. Si la
  app sale antes, la función vieja descarta el `track` (igual que hoy). Si la función
  sale antes que la migración, el registro falla, se reporta a Sentry y el mensaje se
  envía igual.

---

## 8. Opt-out (entrante)

El handler de WhatsApp entrante (`process-whatsapp`) detecta intención de baja
(STOP / "no me escriban" / "ya no quiero mensajes") y llama
`setRetentionOptOut(phone, businessId)`. El RPC de candidatos excluye opted-out.
Confirmar al cliente ("listo, no te escribiremos más"). Detección por keywords
deterministas, sin LLM en el camino crítico.

---

## 9. Criterios de Aceptación

* **AC-1 — Detección:** cliente con última visita (cita pasada no `cancelled` ni
  `no_show`) hace más de N días y sin cita futura → elegible. Una cita pasada que
  sigue `pending` o `confirmed` cuenta como visita; un `no_show` no.
* **AC-2 — Excluido por cita futura activa** → no elegible.
* **AC-3 — Repetición:** mensaje enviado hace menos de N días → no elegible; hace
  más de N días y sigue sin volver → elegible otra vez.
* **AC-4 — Sin teléfono** → no elegible.
* **AC-5 — Toggle OFF:** `ProcessRetentionUseCase` con `retention.enabled=false`
  → no-op, 0 envíos.
* **AC-6 — Topes diarios:** un negocio con más de 3 candidatos envía exactamente 3
  (`capped=true`) aunque tenga guardado otro `dailyCap`; la plataforma envía como
  máximo 37 por día entre todos los negocios y los demás esperan al día siguiente.
* **AC-7 — Envío marca anti-spam:** envío OK → `last_reengaged_at = now()`.
* **AC-8 — Opt-out:** cliente que pidió baja → nunca elegible.
* **AC-9 — Plantilla obligatoria:** envío con `type:"template"`, nunca texto libre.
* **AC-10 — Tenant:** todo opera scoped por `business_id`.
* **AC-11 — Plan gating:** negocio `free` → `ProcessRetentionUseCase` no-op y el
  toggle del dashboard aparece bloqueado; solo `pro`/`enterprise` ejecutan.

---

## 10. Plan por Fases (cada fase aislada y testeable)

1. ✅ **Migración v1** (columnas + RPC) — aplicada y validada en prod.
2. ✅ **Repo + interfaz:** `findInactiveByFrequency` + `updateLastReengaged`
   implementados en `IClientRepository` / `SupabaseClientRepository` (+ tests
   unitarios: mapeo RPC snake→camel, args, invalidación de caché, error paths).
   `setRetentionOptOut` se mueve a la Fase 5 (depende de `retention_opted_out`).
   Nota: la regeneración completa de `types/database.types.ts` se descartó —
   el archivo tiene entradas mantenidas a mano (p.ej. `fn_get_dashboard_stats`,
   inexistente en prod); se añadieron a mano solo el RPC + las 2 columnas v1.
3. ✅ **Use-cases:** `GetEligibleClientsUseCase` + `ProcessRetentionUseCase` en
   `lib/domain/use-cases/retention/` (puro dominio; puerto `IRetentionMessenger`
   para el envío, sin acoplar al Edge Function). Helper `canAccessRetention` en
   `lib/plans/plan-limits.ts`. Tests con repos/puerto mock cubren AC-5 (toggle
   OFF), AC-6 (cap + default 50), AC-7 (stamp anti-spam solo en envío OK), AC-11
   (free / plan null = no-op). El adapter concreto del puerto (envuelve
   `sendReactivationMessage` con `template:'client_winback'`) + el wiring se
   hacen en la Fase 4 junto al cron.
4. ✅ **Cron (enfoque A — decidido con el dueño):** como el use-case vive en Node,
   pg_cron dispara la **route Next** `POST /api/cron/retention` (no un edge
   function). La route (auth `CRON_SECRET`, cliente service-role) lista los
   negocios vía `findRetentionEnabledIds()` y corre `ProcessRetentionUseCase` por
   cada uno; el use-case re-valida plan+toggle (defensa en profundidad). Adapter
   `WinbackMessenger` (`lib/services/winback-messenger.ts`) envuelve
   `sendReactivationMessage` con `template:'client_winback'`. Migración pg_cron
   `20260614130000_schedule_cron_retention.sql` (1×/día 14:00 UTC ≈ 9 AM Bogota,
   secret desde Vault). **Medido en producción el 2026-11-20:** el job
   `cron-retention-daily` existe, está activo y corre todos los días; la entrada del
   Vault `cron_secret` existe y la ruta responde (50 llamadas a `whatsapp-service`
   a las 14:00 UTC). Gating per-negocio por hora local = v2.
5. ✅ **Opt-out:** migración `retention_opted_out` + RPC con
   `and not retention_opted_out` (ambos aplicados en prod). Node:
   `setRetentionOptOut` en el repo. Deno: `process-whatsapp/retention-optout.ts`
   (`isOptOutRequest` determinista — no colisiona con "cancelar cita" — +
   `markRetentionOptOut` por `phone_digits`/business, invalida caché), conectado
   en `message-handler` como intercept antes del agente. Tests Node + Deno.
   `process-whatsapp` ya está desplegado (versión activa del 2026-11-07, posterior
   a este código; medido por la API de funciones).
6. ✅ **Dashboard:** Card de retención en Settings (`app/[locale]/dashboard/settings`)
   con toggle + modal de frecuencia (sin valor por defecto desde 2026-11-22, persiste en
   `default_attendance_frequency_days`; el toggle escribe `settings.retention`).
   **Plan-gated:** en `free` el toggle se reemplaza por un botón bloqueado (`Lock`
   + upsell a `/dashboard/plans`) vía `canAccessRetention(plan)`. i18n en los 6
   locales (`settings.retention.*`). Panel de "reenganchados" = opcional, v2.
7. **Plantilla Meta** `client_winback` (trámite externo). **Estado 2026-11-20:** se
   creó a mano en la cuenta Cronix (Marketing, español) y quedó **En revisión**; el
   2026-11-21 figura aprobada ("Activa: calidad pendiente", sin motivo de rechazo y
   sin que Meta la recategorizara), con 0 mensajes enviados.
   Hasta entonces la cuenta solo tenía `daily_owner_summary` y
   `appointment_reminder`. El negocio no está verificado (límite de 250
   conversaciones por 24 h); no se midió si eso afecta la aprobación. El toggle del
   único negocio que lo tenía encendido (plan enterprise) se apagó ese día. Sentry
   registra un error 132001 por corrida desde el 14/11 a las 14:00 UTC, sin que nada
   más lo mostrara (el 20/11 se midieron 50 envíos). El corte de §7.1 evita que se
   repita.
8. **v2:** frecuencia por-servicio/por-cliente, log de auditoría, métricas.
