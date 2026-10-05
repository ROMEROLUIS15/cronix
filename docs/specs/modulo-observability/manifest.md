# 📋 Manifiesto de Dominio: Observabilidad de Agentes IA

> **Estado:** 🟢 La **infraestructura de trazas y captura de excepciones** está
> implementada y verificada contra código (2026-06-15). La **alerta de umbral por
> negocio sobre `ai_traces` (Paso 2)** está **implementada (2026-10-05)** con canal
> Sentry (§5), desplegada en prod y con entrega por email verificada (2026-10-05).

Define cómo el sistema **observa a sus agentes IA** (voz y WhatsApp): qué se
traza, dónde aterriza, cómo se detecta un fallo, y cómo se **alerta activamente**
ante una degradación. El principio rector: el operador no debe descubrir un
incidente abriendo un dashboard — el sistema debe **empujarle** la señal.

---

## 1. Propósito

Toda interacción de un agente IA emite **una traza estructurada** que permite
responder, sin leer logs crudos: ¿el turno tuvo éxito?, ¿cuánto tardó?, ¿cuántos
tokens?, ¿qué herramientas corrió?, y si falló, ¿con qué código? Sobre ese
sustrato se construyen dos capas de señal: **pasiva** (dashboard) y **activa**
(captura de excepciones + alertas de umbral).

---

## 2. Arquitectura de Trazas (dual-sink) — 🟢 implementado

Vive en `supabase/functions/_shared/observability/`.

* **`CompositeSink`** despacha cada traza a múltiples sinks. El `PgTraceSink` es
  **autoritativo** (su id manda); los demás son best-effort.
* **`PgTraceSink` (CANÓNICO, fuente de verdad):** `INSERT` en la tabla
  `ai_traces`. Multi-tenant por **RLS** (`current_business_id()`); el repo pasa
  `business_id` explícito también, por defensa en profundidad y para que el
  planner use el índice compuesto `(business_id, created_at)`.
* **`LangSmithSink` (best-effort, degradable):** fan-out a LangSmith para
  debugging profundo. Si falla, degrada con un breadcrumb y **NO rompe el turno**.
  Por diseño NO es fuente de alertas (puede estar caído en silencio — ya pasó:
  el fan-out estuvo apagado en prod sin que nadie lo notara).

### Esquema relevante de `ai_traces`

Columnas escritas por `PgTraceSink.write()`: `business_id`, `channel`,
`actor_kind`, `actor_key`, `query_sha`, `outcome`, `error_code`,
`final_text_sha`, `total_tokens`, `latency_ms`, `steps_count`, `tools_count`,
`llm_steps`, `tool_calls`, `metadata`, `created_at`.

### Captura de conversación y decisión (WhatsApp) — 🟢 implementado 2026-06-19

`ai_traces` guardaba **solo hashes** del mensaje (`query_sha`) y de la respuesta (`final_text_sha`), por lo que un comportamiento **silenciosamente incorrecto** (p.ej. `outcome=success` pero agendó la fecha equivocada) era invisible y solo se detectaba si el dueño pegaba la conversación. Correcciones (NORMATIVO):

* **Cada turno se traza, incluidos los deterministas de 0 tokens** (FAQ, propuesta/ejecución de booking, hueco de hora, lista de citas). Antes retornaban **antes** de `tracer.start()` → invisibles. Ahora `runAgentLoop` emite una traza por cada salida (`quickTrace`), con el campo `metadata.path` (`faq` | `deterministic_booking` | `deterministic_gap` | `deterministic_list` | `deterministic_write` | `llm`).
* **Contenido depurado en `metadata`:** `metadata.queryText` y `metadata.finalText` guardan el texto del cliente y de la respuesta **con PII depurada** (teléfonos→`[PHONE]`, tokens→`[TOKEN]`; fechas/horas se conservan para depurar). Es el operador (founder) quien lo consume; no se expone al cliente.
* **Decisión de booking auditable:** en la escritura determinista, `metadata.booking = { tool, service_id|appointment_id, date|new_date, time|new_time, source:'client-stated' }`.
* **Auto-catch de alucinación (`metadata.llmProposedBooking`):** tras el rediseño determinista, el LLM **no debe** emitir una propuesta `¿Confirmo… para el … a las …?`. Si el texto final del LLM coincide con ese patrón, se marca `llmProposedBooking=true` **y** se captura en Sentry (`stage: llm_proposed_booking`) — el bug se atrapa solo, sin que el dueño lo reporte.
* **Contrato:** `TraceFinish` admite `metadata?` que se **mergea** sobre la metadata de `start()` al cerrar (cambio espejado en la copia Node `lib/ai/observability/` y la Deno `_shared/observability/`; paridad verificada).

### Catálogo normativo de `outcome` y `error_code`

`TraceOutcome` (`contracts.ts`): `success` | `failure` | `no_action` |
`rate_limited` | `error`.

**Dónde vive cada código (corregido 2026-10-05 contra datos reales).** Un código
puede aparecer en dos sitios y la alerta lee **ambos**:

* **Columna `ai_traces.error_code`:** la escribe el tracer al cerrar el turno
  (`LLM_EXCEPTION`, `STT_NOISE`, `rate_limited`…). En WhatsApp el valor es
  **texto libre `CODIGO: detalle`** (p.ej. `TOOL_EXECUTION_ERROR: error interno…`),
  por eso se normaliza por el prefijo antes de `:`.
* **`ai_traces.tool_calls[].errorCode`** (jsonb, clave camelCase): el código de
  cada herramienta ejecutada en el turno. `GUARD_REJECTED`, `REVIEWER_BLOCKED`,
  `TOOL_FAILURE`, `FAST_PATH_FAILURE` y `DB_ERROR` **solo** viven aquí, nunca en la
  columna.

| Código | Significado | ¿Cuenta como fallo real? |
|---|---|---|
| `LLM_EXCEPTION` | Excepción no controlada del pipeline LLM (p.ej. Groq caído) | **SÍ** |
| `DB_ERROR` | Una consulta Supabase de una herramienta de voz devolvió `error` (nuevo 2026-10-05; todas las capabilities de voz lo marcan) | **SÍ** |
| `TOOL_EXECUTION_ERROR` | Fallo interno de ejecución de una herramienta de WhatsApp (formato `CODIGO: detalle`) | **SÍ** |
| `outcome = 'error'` | El turno terminó en error (cualquier código o ninguno) | **SÍ** |
| `TOOL_FAILURE` / `FAST_PATH_FAILURE` | Fallback genérico de voz (`voice-pipeline.ts` / `agent.ts`). **Mezcla** errores reales con turnos de aclaración/validación (p.ej. "¿a qué hora?") → no distingue | **NO** |
| `rate_limited` (columna y `outcome`) | Lo emiten los **guards**: voz 30 req/min por usuario y `BOOKING_RATE_LIMIT` de WhatsApp. **No** es cuota del proveedor | **NO** |
| `STT_NOISE` | Audio/texto ininteligible; guard determinista responde 422 | **NO** |
| `GUARD_REJECTED` | Un mention-guard/umbral bloqueó una acción insegura | **NO** (el guard FUNCIONANDO) |
| `REVIEWER_BLOCKED` | El reviewer constitucional vetó/degradó (voz: solo `delete_client` hard-block) | **NO** (señal de calidad, no fallo) |
| `SLOT_CONFLICT`, `APPOINTMENT_NOT_FOUND`, `UNAUTHORIZED`, `INVALID_ARGS`, `INVALID_ARGUMENTS`, `DUPLICATE_CALL` | Resultados de negocio/validación esperados | **NO** |

> **Invariante de clasificación:** solo la **lista de permitidos** de la tabla
> (`LLM_EXCEPTION`, `DB_ERROR`, `TOOL_EXECUTION_ERROR` y `outcome='error'`) cuenta
> como fallo para efectos de alerta. `STT_NOISE`, los códigos de **guard**
> (`GUARD_REJECTED`, `REVIEWER_BLOCKED`), los límites de tasa y los resultados de
> negocio NUNCA cuentan — son mecanismos de seguridad o flujo normal operando como
> se diseñó. Confundirlos con fallos genera alarma falsa y erosiona la confianza en
> las alertas.

> **Mapeo del código de herramienta de voz (2026-10-05):** `supabase/functions/voice-worker/core/tool-error-code.ts`
> (`toolErrorCode`) convierte `ToolResult.error` en el `errorCode` de la traza:
> deja pasar `GUARD_REJECTED`, `REVIEWER_BLOCKED` y `DB_ERROR`; cualquier otro valor
> cae al fallback del llamador (`FAST_PATH_FAILURE` en `agent.ts`, `TOOL_FAILURE` en
> `voice-pipeline.ts`). Antes había dos ternarios duplicados que descartaban todo lo
> demás.

---

## 3. Captura de Excepciones (Sentry) — 🟢 implementado (Paso 1, desplegado 2026-06-15)

* Helper compartido `_shared/sentry.ts` (`initSentry`, `captureException`,
  `addBreadcrumb`, `setSentryTag`, `flushSentry`): PII scrubbing (teléfonos,
  tokens Meta, Bearer, secretos), **no-op si falta `SENTRY_DSN`**.
* **Invariante de flush:** en runtime Deno el worker puede morir antes de que el
  envío async complete ⇒ `await flushSentry()` es **obligatorio** antes de cada
  `return Response` que haya capturado una excepción.
* **`voice-worker`** conecta el helper en sus 3 error-paths (`index.ts`: init
  Supabase, parseo de payload, **agent loop** — que atrapa el `LLM_EXCEPTION`
  re-lanzado desde `agent.ts`), con tag `business_id`. Cierra el fallo
  **silencioso**: antes, un 500 del agente solo hacía `console.error` y el único
  rastro quedaba en `ai_traces` (pull). `process-whatsapp` ya usaba este patrón.
* **Invariante de no-duplicación:** se captura en UN solo punto por cadena de
  error (el catch más externo que tiene `business_id` en scope), no en cada capa
  que re-lanza, para evitar eventos duplicados en Sentry.
* **Señales de caída silenciosa (`captureMessage`, 2026-10-05):** no todo incidente
  es una excepción. `_shared/sentry.ts` expone `captureMessage(message, level, extra,
  fingerprint?)` (no-op sin `SENTRY_DSN`, mismo scrubbing de PII; el `fingerprint`
  opcional fija el agrupamiento, usado por el Paso 2 para un issue por negocio) para empujar degradaciones que
  antes devolvían 200 sin rastro. Mensaje constante por señal → Sentry agrupa todas
  las ocurrencias en un solo issue; el dato variable va en `extra`.
  * `wa_unrouted_message` (warning) — un mensaje de WhatsApp que no se pudo asignar a
    ningún negocio y recibió el landing genérico. Sin contenido (solo tipo, longitud y
    si traía slug). No puede ir a `ai_traces` porque esa tabla exige `business_id`. Es
    la señal que habría delatado el incidente 2026-07-29 → 2026-10-05: las respuestas
    al recordatorio se perdieron durante semanas con el dashboard "limpio".
  * `owner_wa_template_failed` (warning) — falló la plantilla de aviso al dueño (p.ej.
    no existe o no está aprobada en la WABA del número); el aviso cae al texto libre, que solo entrega dentro de la
    ventana de 24h.
  * `owner_wa_undelivered` (error) — también falló el texto libre: el dueño no recibió
    WhatsApp (campana y push no se ven afectados).
* **Limitación conocida:** Meta acepta un texto libre fuera de la ventana de 24h y lo
  descarta después (llega por el webhook `statuses`, que `whatsapp-webhook` hoy filtra)
  → esa no-entrega sigue sin ser observable.

---

## 4. Dashboard pasivo — 🟢 implementado

`/dashboard/observability` (`app/[locale]/dashboard/observability/`) lee de
`ai_traces` vía `ObservabilityRepo` (ventana 24h): resumen (total, éxito, fallos,
no_action, tokens, **p50/p95** de latencia), top de `error_code`, y trazas
recientes. Es señal **pasiva** (pull) — complementa, no reemplaza, la activa.

---

## 5. Paso 2 — Alerta de Umbral por Negocio sobre `ai_traces` → Sentry — 🟢 implementado (2026-10-05)

> **Por qué existe:** el Paso 1 (§3) solo ve **excepciones**; un turno que falla sin
> lanzar (el agente nunca lanza ante un turno fallido: el tracer escribe `outcome`)
> es invisible para Sentry. Este paso mira `ai_traces` por negocio y **empuja** la
> señal al operador. El contrato original (query sobre
> `LLM_EXCEPTION|rate_limited|TOOL_FAILURE|FAST_PATH_FAILURE`) no coincidía con la
> forma real de los datos (ver §2) y se corrigió antes de implementar.

### Contrato implementado

* **Trigger:** `pg_cron` `cron-ai-alerts` cada **10 min** (migración
  `supabase/migrations/20261005120000_ai_failure_alerts.sql`) → `net.http_post` a la
  edge function `supabase/functions/cron-ai-alerts/` con `Authorization: Bearer
  <cron_secret>` leído de Vault (mismo patrón que `cron-imminent-push`).
* **Evaluación en Postgres:** `fn_claim_ai_failure_alerts()` (`SECURITY DEFINER`,
  `EXECUTE` solo a `service_role`) toma un `pg_advisory_xact_lock` (dos ticks
  solapados no reclaman dos veces), clasifica las trazas de la ventana, agrupa por
  `business_id`, aplica umbral y cooldown, **inserta** los reclamos en
  `ai_failure_alerts` y los **devuelve**. No envía nada y **no escribe en
  `ai_traces`** (el cron no se cuenta a sí mismo).
* **Entrega:** el handler (`supabase/functions/cron-ai-alerts/handler.ts`, puro y
  testeable; cableado en `index.ts`) emite por cada reclamo un
  `captureMessage('ai_agent_failure_threshold', 'error', { business_id,
  failure_count, breakdown, window_min }, ['ai_agent_failure_threshold',
  business_id])` y hace `flushSentry()` antes de responder. El **fingerprint por
  negocio** da un issue de Sentry por tenant: un segundo negocio en llamas es un
  issue nuevo, no una ocurrencia más. `captureMessage` (`_shared/sentry.ts`) acepta
  el parámetro opcional `fingerprint` (retrocompatible).
* **Destinatario:** el **operador (founder)**, no el dueño del salón.

### Qué es un "fallo real" (NORMATIVO)

Por **traza** (= un turno; una traza cuenta **como máximo una vez**), es fallo si
cumple **cualquiera** de:

1. `outcome = 'error'`;
2. el `error_code` de la **columna**, normalizado, está en la lista de permitidos;
3. algún elemento de `tool_calls` tiene `errorCode`, normalizado, en la lista.

* **Lista de permitidos:** `LLM_EXCEPTION`, `DB_ERROR`, `TOOL_EXECUTION_ERROR`.
* **Normalizar:** `split_part(code, ':', 1)` recortado (WhatsApp guarda
  `'CODIGO: detalle'`).
* Todo lo demás NO cuenta (ver tabla de §2): guards, `STT_NOISE`, `rate_limited`,
  `SLOT_CONFLICT`, `TOOL_FAILURE`, `FAST_PATH_FAILURE`, etc.
* `breakdown` = objeto `código → nº de trazas fallidas` (clave `outcome:error` para
  el caso 1). Una traza puede aportar a varios códigos del breakdown pero suma **1**
  a `failure_count`.

### Valores (constantes al inicio de la función SQL)

Ventana **10 min**, umbral **3 turnos fallidos por negocio**, cooldown **60 min por
negocio**. Valores de la propuesta original, a calibrar con volumen real (hoy muy
bajo).

### Cooldown y auditoría

Tabla `ai_failure_alerts` (`business_id`, `created_at`, `window_min`,
`failure_count`, `breakdown`; índice `(business_id, created_at DESC)`; RLS activa
**sin** políticas para `anon`/`authenticated`: dato de operador, solo
`service_role`). Es la fuente de verdad del cooldown y el registro de auditoría.
Es **independiente** de `ai_agent_alerts` (la del Slack).

* **Índice de ventana:** la migración crea `idx_ai_traces_created_at`. La consulta es
  cross-tenant por ventana de tiempo, y todos los índices previos de `ai_traces`
  empiezan por `business_id`; sin este índice cada corrida recorrería la tabla
  entera, que no tiene política de retención.
* **Trade-off de entrega (propuesto por el agente y aceptado por el usuario, 2026-10-05):** la alerta se reclama (fila insertada) antes de
  enviarla a Sentry. Si el envío falla o falta `SENTRY_DSN`, esa alerta se pierde y
  el negocio queda en cooldown 60 min. Se prefirió a reintentar y arriesgar avisos
  duplicados; la fila queda como rastro auditable.

### Invariantes normativas del Paso 2

* **Exclusión de benignos (CRÍTICO):** solo cuenta la lista de permitidos; ver §2.
* **Cooldown anti-spam:** máximo **1 alerta por `business_id` cada 60 min**.
* **No auto-alerta:** `fn_claim_ai_failure_alerts` jamás escribe en `ai_traces`.
* **Aislamiento (constitution §4):** el conteo se agrupa por `business_id`; nunca se
  suman fallos de negocios distintos. La función es operador-global a propósito
  (job cross-tenant) y por eso solo la ejecuta `service_role`.
* **Auth:** sin `Bearer CRON_SECRET` válido → 401 y no se consulta nada.

### Decisiones resueltas (propuesta del agente aceptada por el usuario, 2026-10-05)

1. **Canal:** **Sentry** (no email/push). Se aceptó que las alertas del Paso 2
   convivan con las excepciones del Paso 1 en el mismo proyecto.
2. **Valores:** ventana 10 min / umbral 3 / cooldown 60 min.
3. **Host:** edge function (como `cron-imminent-push`), no Next route.
4. **Lista de permitidos y lectura de ambos niveles** (columna + `tool_calls`), con
   normalización por prefijo, en lugar de la consulta literal del diseño original.
5. **Voz marca `DB_ERROR`** en sus capabilities (ver §2) para no quedar ciega.

### Coexistencia con la alerta de Slack (decisión del usuario: "no elimines slack")

La alerta global de `20260605120000_ai_agent_error_alerts.sql`
(`check_ai_agent_error_rate`, tabla `ai_agent_alerts`, doc
`docs/operations/AI_AGENT_ALERTS.md`) **sigue intacta**. Ambas conviven; difieren en
la pregunta que responden:

| | Slack (`check_ai_agent_error_rate`) | Sentry (`fn_claim_ai_failure_alerts`) |
|---|---|---|
| Alcance | **Global** (todos los negocios agregados) | **Por negocio** |
| Disparo | tasa de error > **5 %** en 60 min con ≥ **20 turnos** | ≥ **3** turnos fallidos en 10 min |
| Qué cuenta | `outcome IN ('failure','error')`, incluidos los rechazos de guard de voz; excluye `rate_limited` | lista de permitidos (§ arriba); los guards **no** cuentan |
| Cooldown | 60 min global | 60 min por negocio |
| Entrega | webhook de Slack (secreto Vault `slack_alerts_webhook_url`) | Sentry |
| Estado | según el usuario, Slack **nunca se usó** en este repo (el webhook no se configuró). No verificado en prod si el job `ai-agent-error-rate-check` está programado | activo tras el paso operativo |

### Paso operativo (no es código) — hecho 2026-10-05

1. Migración aplicada en prod y `cron-ai-alerts` desplegada (`supabase functions
   deploy cron-ai-alerts --use-api`; requiere `verify_jwt = false` en
   `supabase/config.toml`, porque pg_cron manda `Bearer CRON_SECRET`, no un JWT).
2. Sentry (org `cronix-saas`, proyecto `javascript-nextjs`) tiene la Alert
   **"Agentes IA – fallos por negocio"** (id 6118587): trigger *An event is
   captured* (`every_event`), filtro `message` contiene
   `ai_agent_failure_threshold`, acción email al dueño de la cuenta, throttling
   60 min, todos los entornos.
   - **No usar "A new issue is created" + regresión:** el fingerprint es uno por
     negocio y el proyecto no auto-resuelve issues, así que el segundo incidente
     de un mismo negocio cae en un issue abierto y no dispararía ni *new issue*
     ni *regression*. El cooldown de 60 min de `fn_claim_ai_failure_alerts()` ya
     deduplica: cada fila reclamada = un email.
   - Entrega verificada con *Send Test Notification* (llegó el email). El filtro
     por `message` todavía no se ha ejercitado con una alerta real.

---

## 6. Criterios de Aceptación (Paso 2)

Verificados por `supabase/tests/ai_failure_alerts.test.sql` (pgTAP, `npx supabase
test db`) y `supabase/functions/cron-ai-alerts/__tests__/handler.test.ts` (Vitest);
el mapeo de voz por `supabase/functions/voice-worker/__tests__/db-error-code.test.ts`
y `supabase/functions/voice-worker/core/__tests__/tool-error-code.test.ts`.

### AC-1 — Sólo cuenta fallos reales
- DADO una ventana de 10 min con trazas `STT_NOISE`, `GUARD_REJECTED` (en
  `tool_calls`), `outcome='rate_limited'`, `SLOT_CONFLICT` y `FAST_PATH_FAILURE`,
- CUANDO se ejecuta `fn_claim_ai_failure_alerts()`,
- ENTONCES el conteo de fallos es **0** y NO se reclama ninguna alerta.

### AC-2 — Umbral por negocio dispara alerta
- DADO un negocio con 3 trazas fallidas en la ventana (una con `LLM_EXCEPTION` en
  la columna, una con `DB_ERROR` dentro de `tool_calls`, una con
  `'TOOL_EXECUTION_ERROR: …'`),
- CUANDO corre el claim,
- ENTONCES se reclama exactamente **1** alerta con `failure_count = 3`; una traza
  con dos tool calls fallidas cuenta **una** vez.
- Y los fallos de negocios distintos no se suman (2 + 2 → ninguna alerta), y las
  trazas con más de 10 min se ignoran.

### AC-3 — Cooldown evita repetición
- DADO un negocio que ya fue reclamado y sigue fallando,
- CUANDO el claim vuelve a correr dentro de los 60 min,
- ENTONCES **no** se reclama una segunda alerta.

### AC-4 — Auth obligatoria
- DADO un `POST` a `cron-ai-alerts` sin `Bearer CRON_SECRET` válido (cabecera
  ausente, secreto incorrecto o `CRON_SECRET` sin configurar),
- CUANDO se procesa,
- ENTONCES retorna 401 y **no** ejecuta el claim.

### AC-5 — Una señal de Sentry por alerta reclamada
- DADO N alertas reclamadas,
- CUANDO responde el handler,
- ENTONCES emite N `captureMessage` de nivel `error`, cada uno con fingerprint
  `['ai_agent_failure_threshold', business_id]`, hace flush y responde
  `{ alerts: N }`; si el RPC falla, captura la excepción, hace flush y responde 500.

### AC-6 — Privilegios
- `authenticated` y `anon` **no** pueden ejecutar `fn_claim_ai_failure_alerts`;
  `service_role` sí.

---

## 7. Fuera de alcance (v1)

* Alertas dirigidas al **dueño del salón** (hoy solo al operador).
* Alertas de **regresión de latencia** (p95 sobre umbral) — el contrato actual es
  sobre `error_code`, no sobre percentiles.
* SLOs / error budgets formales.
* Routing/escalado de alertas (PagerDuty, on-call).

---

## Historial de Versiones

| Fecha | Cambio |
|---|---|
| 2026-06-15 | Creación. Documenta la infra de trazas dual-sink (PgTraceSink canónico + LangSmith best-effort), la captura de excepciones Sentry en voice-worker (Paso 1, desplegado), el dashboard pasivo, y fija el contrato del **Paso 2** (alerta de umbral sobre `ai_traces`) como diseño 🔴 con decisiones abiertas. |
| 2026-10-05 | §3: señales de caída silenciosa vía `captureMessage` (`wa_unrouted_message`, `owner_wa_template_failed`, `owner_wa_undelivered`), tras el incidente en que las respuestas al recordatorio se perdieron sin traza (última traza WhatsApp del 2026-07-29). Documentada la limitación de la no-entrega asíncrona de Meta. |
| 2026-10-05 | **Paso 2 implementado (🔴 → 🟢): alerta de fallos por negocio → Sentry.** El contrato original no coincidía con los datos reales: `TOOL_FAILURE`/`FAST_PATH_FAILURE`/`GUARD_REJECTED` solo viven en `tool_calls[].errorCode` (nunca en la columna), en voz mezclan errores reales con turnos de aclaración, y `rate_limited` lo emiten los guards (voz 30 req/min por usuario, `BOOKING_RATE_LIMIT` de WhatsApp), no la cuota del proveedor. §2 corregido; fallo real = lista de permitidos (`LLM_EXCEPTION`, `DB_ERROR`, `TOOL_EXECUTION_ERROR`) + `outcome='error'`, leída de columna **y** `tool_calls`, normalizada por el prefijo antes de `:`. Voz ahora marca `DB_ERROR` en todas las capabilities y un único helper (`toolErrorCode`) reemplaza dos ternarios duplicados. Nueva tabla `ai_failure_alerts` (cooldown + auditoría, solo `service_role`), `fn_claim_ai_failure_alerts()` (advisory lock, ventana 10 min / umbral 3 / cooldown 60 min por negocio), `pg_cron` `cron-ai-alerts` → edge function homónima → `captureMessage` con fingerprint por negocio (parámetro nuevo y opcional en `_shared/sentry.ts`). La alerta global de Slack **se mantiene** por decisión del usuario; §5 documenta la diferencia. Decisiones propuestas por el agente y aceptadas por el usuario el 2026-10-05. **Pendiente operativo:** aplicar la migración, desplegar `cron-ai-alerts` (`--use-api`) y verificar en Sentry una regla que notifique issues nuevos de nivel `error`. **pgTAP:** `supabase/tests/ai_failure_alerts.test.sql` 14 asserts, `supabase test db` local PASS (161 en total), verificado por mutación (contar guards/`FAST_PATH_FAILURE` como fallo, o ignorar `tool_calls` → 4/14 fallan en cada caso). Índice nuevo `idx_ai_traces_created_at`. **Seguimiento:** los `result` de voz de los errores de BD filtran `error.message` crudo al TTS (fuera de alcance aquí). |
