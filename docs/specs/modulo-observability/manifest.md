# 📋 Manifiesto de Dominio: Observabilidad de Agentes IA

> **Estado:** 🟡 Mixto. La **infraestructura de trazas y captura de excepciones**
> está implementada y verificada contra código (2026-06-15) → 🟢. La **alerta de
> umbral sobre `ai_traces` (Paso 2)** es **diseño aún NO implementado** → 🔴; vive
> aquí para fijar el contrato antes de codear (Ley Cero: zona sin spec requiere
> confirmación). Las decisiones abiertas están marcadas explícitamente.

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

| `error_code` | Significado | ¿Es fuego? |
|---|---|---|
| `STT_NOISE` | Audio/texto ininteligible; guard determinista responde 422 | **NO** (benigno, esperado) |
| `LLM_EXCEPTION` | Excepción no controlada del pipeline LLM (p.ej. Groq caído) | **SÍ** |
| `rate_limited` | Cuota/límite de proveedor agotado | **SÍ** |
| `TOOL_FAILURE` / `FAST_PATH_FAILURE` | Una herramienta falló en ejecución | **SÍ** (tendencia) |
| `GUARD_REJECTED` | Un mention-guard/umbral bloqueó una acción insegura | **NO** (el guard FUNCIONANDO) |
| `REVIEWER_BLOCKED` | El reviewer constitucional vetó/degradó (voz: solo `delete_client` hard-block) | **NO** (señal de calidad, no fallo) |

> **Invariante de clasificación:** `STT_NOISE` y los códigos de **guard**
> (`GUARD_REJECTED`, `REVIEWER_BLOCKED`) NUNCA cuentan como fallo para efectos de
> alerta — son mecanismos de seguridad operando como se diseñó. Confundirlos con
> fallos genera alarma falsa y erosiona la confianza en las alertas.

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

---

## 4. Dashboard pasivo — 🟢 implementado

`/dashboard/observability` (`app/[locale]/dashboard/observability/`) lee de
`ai_traces` vía `ObservabilityRepo` (ventana 24h): resumen (total, éxito, fallos,
no_action, tokens, **p50/p95** de latencia), top de `error_code`, y trazas
recientes. Es señal **pasiva** (pull) — complementa, no reemplaza, la activa.

---

## 5. Paso 2 — Alerta de Umbral sobre `ai_traces` — 🔴 DISEÑO (NO implementado)

> **Justificación de prioridad (diferido conscientemente):** el Paso 1 (Sentry)
> ya cubre el caso crítico —el fallo silencioso por `LLM_EXCEPTION`—. El Paso 2
> aporta señal sobre **tendencias de negocio** que Sentry no ve (picos de
> herramientas fallando, `rate_limited` sostenido, regresión de p95). NO es
> urgente. Este §5 fija el contrato para cuando se retome.

### Contrato propuesto

* **Trigger:** `pg_cron` cada **10 min** dispara un endpoint protegido (Next route
  `/api/cron/observability-alert` **o** edge function), auth `Bearer CRON_SECRET`
  leído desde Supabase Vault (mismo patrón que `cron-retention` /
  `cron-imminent-push`; el secreto nunca vive en código).
* **Consulta:** sobre `ai_traces`, ventana últimos **10 min**, agrupada por
  `business_id`, contar filas donde `error_code IN ('LLM_EXCEPTION',
  'rate_limited','TOOL_FAILURE','FAST_PATH_FAILURE')`.
* **Disparo:** si el conteo de una ventana ≥ `alertThreshold` (default **3**),
  emitir alerta.
* **Multi-tenant:** la evaluación es **por negocio** (un fuego en un salón no
  debe diluirse en el agregado), pero el destinatario de la alerta v1 es el
  **operador (founder)**, no el dueño del salón.

### Invariantes normativas del Paso 2

* **Exclusión de benignos (CRÍTICO):** la consulta NUNCA cuenta `STT_NOISE` ni los
  códigos de guard (`GUARD_REJECTED`, `REVIEWER_BLOCKED`). Ver §2.
* **Cooldown anti-spam:** máximo **1 alerta por `business_id` por ventana de
  incidente** (sugerido: silenciar 60 min tras una alerta del mismo negocio), para
  no repetir la misma falla cada 10 min. Sin esto, un incidente de 1h genera 6
  alertas idénticas y se vuelve ruido.
* **Idempotencia / no auto-alerta:** el propio cron de alerta no debe trazar a
  `ai_traces` de forma que se cuente a sí mismo.
* **Aislamiento (constitution §4):** toda consulta filtra/ agrupa por
  `business_id`.

### ⚠️ Decisiones abiertas (requieren confirmación del operador antes de codear)

1. **Canal de la alerta:** ¿reusar **Sentry** (entonces el Paso 2 es casi
   redundante con el Paso 1 para `LLM_EXCEPTION`, y solo aporta para
   `TOOL_FAILURE`/`rate_limited`)? ¿o canal aparte (email vía el proveedor ya
   usado / push)? **Esta decisión define si el Paso 2 vale la pena.**
2. **Valores concretos:** `alertThreshold` (default propuesto 3), ventana (10 min),
   cooldown (60 min) — a calibrar con el volumen real (hoy muy bajo: 1 incidente
   en ~48h).
3. **Host del cron:** Next route (como `cron-retention`) vs edge function (como
   `cron-reminders`). Preferencia: Next route si el canal es email (reusa infra
   de la app).

---

## 6. Criterios de Aceptación (Paso 2 — para cuando se implemente)

### AC-1 — Sólo cuenta fallos reales
- DADO una ventana de 10 min con 5 trazas `STT_NOISE` y 1 `GUARD_REJECTED`,
- CUANDO corre el cron de alerta,
- ENTONCES el conteo de fallos es **0** y NO se emite alerta.

### AC-2 — Umbral por negocio dispara alerta
- DADO un `business_id` con `alertThreshold=3` y 3 trazas `LLM_EXCEPTION` en la ventana,
- CUANDO corre el cron,
- ENTONCES se emite exactamente **1** alerta para ese negocio.

### AC-3 — Cooldown evita repetición
- DADO un negocio que ya recibió una alerta hace 20 min y sigue fallando,
- CUANDO corre el cron de nuevo dentro del cooldown (60 min),
- ENTONCES **no** se emite una segunda alerta.

### AC-4 — Auth obligatoria
- DADO un `POST` al endpoint sin `Bearer CRON_SECRET` válido,
- CUANDO se procesa,
- ENTONCES retorna 401 y no ejecuta la consulta.

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
