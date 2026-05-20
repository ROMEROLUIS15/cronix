# Changelog — Cronix

Todos los cambios significativos en este proyecto serán documentados en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/) y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased]

### Corregido

#### Voice agent: bucle de agendamiento multi-turno

Se corrigió un bug en el asistente de voz del dashboard donde, tras pedir un dato faltante (p. ej. el servicio), el modelo volvía a pedir fecha y hora ya proporcionadas turnos antes, atrapando al usuario en un loop.

**Causa raíz:**
- El `frame-cutoff` del corpus (capa 4 anti-alucinación) cortaba en cualquier turno asistencial sin `?`. Frases de confirmación intermedia como "Perfecto, te confirmo: 21 de mayo a las 3pm" pasaban como boundary y truncaban el corpus, eliminando los slots dados en turnos previos.
- El prompt no instruía explícitamente al LLM a leer el historial en busca de datos ya proporcionados.
- `reschedule/tool.ts` no tenía el override desde corpus que sí tenía `schedule/tool.ts`, por lo que sufría la misma fragilidad.

**Cambios:**
- Nuevo módulo `voice-worker/core/conversation/frame.ts` con 8 marcadores terminales explícitos (`Listo.`, `Cancelado.`, `Reagendado.`, `Agendado.`, `No encontré`, `No pude`, `No hay`, `ya está ocupado`). Solo estos cierran el frame.
- Nuevo módulo `voice-worker/core/conversation/slot-extractor.ts` con extracción de slots desde corpus reutilizada por schedule y reschedule (paridad).
- `schedule/tool.ts` refactorizado en 3 pasos nombrados (override / missing / anti-hallucination).
- `reschedule/tool.ts` ahora también recupera `new_date`/`new_time` desde corpus.
- Prompt `voice-worker/prompt.ts`: añadidas secciones MEMORIA DE TURNOS (con ejemplo multi-turno) y CIERRE DE TURNO — USO OBLIGATORIO DEL SIGNO DE INTERROGACIÓN.
- Cobertura anti-regresión: `voice-worker/core/__tests__/frame.test.ts` (15 tests nuevos).

### Cambiado

Documentación de la sección 7.4 (Frame-cutoff del corpus) actualizada en `TECHNICAL_DOCUMENTATION.md`, `TECHNICAL_DOCUMENTATION_ES.md` y `AI_SYSTEM.md` para reflejar el nuevo módulo y la regla de marcadores terminales.

---

## [0.5.0] — 2026-05-02

### Cambiado

#### Refactor UI: Botones de Pago Responsivos en Gestión de Planes

La interfaz de gestión de planes (`plan-manager.tsx`) fue reorganizada para mejorar la experiencia en móvil y escritorio.

**Cambios técnicos:**
- **Móvil**: Los botones "Activar Pro" y "Activar Enterprise" se movieron al interior de la tarjeta de cada plan, justo debajo de su lista de características. Se eliminaron los botones unificados que aparecían al final de la pantalla.
- **Escritorio**: Se añadió una fila de acción al final de la tabla comparativa con un botón por columna de plan de pago (Pro / Enterprise), eliminando los botones globales inferiores.

---

#### Estrategia de Monetización — Plan Pro (Opción 2)

Se ajustaron los límites del Plan Pro para crear un embudo de ventas más efectivo hacia el Plan Enterprise.

**Nueva estrategia:**
- **Plan Free ($0):** Límite de 1 miembro (solo el dueño), 20 clientes y 30 citas/mes. Actúa como gancho para forzar el pago de $10.
- **Plan Pro ($10/mes):** Reducido a **2 miembros en total** (Dueño + 1 asistente) y **150 citas/mes**. Diseñado para profesionales independientes con un asistente (ej. odontólogo + secretaria). El límite de empleados y de citas obliga al salto a Enterprise al crecer.
- **Plan Enterprise ($15/mes):** Sin límites de equipo ni citas.

**Cambios técnicos:**
- `lib/plans/plan-limits.ts` — Única fuente de verdad actualizada: Pro `employees: 3 → 2`, `appointmentsPerMonth: Infinity → 150`. Las validaciones en `createEmployeeAction` y `checkAppointmentLimit` recogen el cambio automáticamente.
- `app/[locale]/dashboard/settings/plan-manager.tsx` — Tabla comparativa actualizada para usar las nuevas claves de traducción.

---

#### i18n — Actualización de Textos de Planes (6 idiomas)

- Clave `freeLimitNote`: Texto actualizado de "1 empleado" a "1 dueño de negocio" en todos los idiomas.
- Claves nuevas `tableUpTo2` y `tableUpTo150`: Añadidas en `es`, `en`, `pt`, `it`, `fr`, `de`.
  - `tableUpTo2` usa formato descriptivo: "Dueño + 1" / "Owner + 1" / "Dono + 1", etc.
  - `tableUpTo150`: "Hasta 150" / "Up to 150" / etc.

---



### Corregido

#### Fix 1: Session Timeout — Enforcement Real del Signout en el Servidor

El middleware `withSessionTimeout` ahora **cierra sesión correctamente en Supabase** cuando expira el tiempo, eliminando las cookies `sb-*` del browser.

**Problema raíz:** `signOutAndRedirect()` creaba el cliente Supabase con un cookie store vacío, por lo que `supabase.auth.signOut()` era un no-op. Las cookies de sesión permanecían en el browser y el usuario podía acceder rutas protegidas.

**Cambios técnicos:**
- `lib/middleware/with-session-timeout.ts` — `signOutAndRedirect` ahora usa `request.cookies.getAll()` como fuente y escribe las cookies de clearing via `setAll` en el response de redirect.
- Eliminada la llamada `copyCookies(baseRes, response)` en las rutas de signout (que re-agregaba las cookies recién eliminadas).

---

#### Fix 2: Output Shield — Falso Positivo en Fechas ISO

El patrón `phone_leak` del Output Shield bloqueaba cualquier respuesta TTS que contuviera una fecha `YYYY-MM-DD` (ej. `2026-04-29`), silenciando al agente.

**Cambios técnicos:**
- `lib/ai/output-shield.ts` — Patrón `phone_leak` actualizado con negative lookahead `(?!\d{4}-\d{2}-\d{2}\b)` para excluir fechas ISO.

---

#### Fix 3: Services Guard — Read Queries Bloqueadas Sin Servicios

Las consultas de lectura ("¿qué tengo hoy?", "resumen de hoy") fallaban cuando el negocio no tenía servicios configurados, porque el services guard corría antes que los fast-paths de lectura.

**Cambios técnicos:**
- `lib/ai/orchestrator/decision-engine.ts` — Fast-paths READ-only (A/B: today/tomorrow) movidos **antes** del services guard. Fast-paths WRITE (C/C2/D) permanecen después del guard.
- `TODAY_QUERY_PATTERN` extendido: ahora captura `"resumen de hoy"` y `"cómo va hoy"`.

---

#### Fix 4: Alucinación de search_clients — "¿Cuál [nombre]?" con resultado único

El LLM inventaba ambigüedad ("¿Cuál Alan Romero quieres decir?") incluso cuando `search_clients` devolvía exactamente un cliente.

**Cambios técnicos:**
- `lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts` — `searchClients` ahora devuelve prefijos estructurados:
  - `CLIENT_FOUND: <name>. Usa este nombre exacto…`
  - `MULTIPLE_CLIENTS: <name1>, <name2>…`
  - `CLIENT_NOT_FOUND: "<query>" no existe…`
- `lib/ai/agents/dashboard/prompt.ts` — Nueva sección `CLIENTES` que prohíbe explícitamente inventar ambigüedad cuando la tool devolvió `CLIENT_FOUND`.

---

### Agregado

#### Refactoring SOLID — Capa de IA del Dashboard

**Archivos nuevos:**
- `lib/ai/agents/IAgent.ts` — Interface `IAgent`, `ResolvedEntities`, `ToolDefEntry`, `AgentConfig`
- `lib/ai/agents/dashboard/index.ts` — `dashboardAgent`: implementación concreta de `IAgent`
- `lib/ai/providers/tts-factory.ts` — `createTtsProvider(apiKey?, model)`: factory TTS (OCP)
- `supabase/functions/process-whatsapp/confirmation-gate.ts` — `lastAssistantWasConfirmation()`, `isAffirmative()`, `toolsAllowedThisTurn()` (SRP)

**Principios aplicados:**
- **DIP**: `DecisionEngine` recibe `IAgent` via constructor injection
- **OCP**: `AiChannel` y `AppointmentEvent.channel` son `'web' | 'whatsapp' | (string & {})` — extensibles sin modificación
- **SRP**: Lógica de confirmation gate extraída de `message-handler.ts`

#### humanizeDate para TTS
- `lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts` — Nueva función `humanizeDate(dateISO, timezone)` que convierte `YYYY-MM-DD` → `"29 de abril"` via `Intl.DateTimeFormat`. Usada en respuestas de `get_appointments_by_date` para output natural en voz.

---

## [0.3.0] — 2026-04-24

### Agregado

#### Ajuste 1: Visibilidad de Citas en el Calendario del Dashboard

El Dashboard ahora **auto-refresca automáticamente** cuando el agente de WhatsApp crea o reagenda citas. No hay necesidad de recargar la página (F5) manualmente.

**Cambios técnicos:**
- `app/[locale]/dashboard/appointments/hooks/use-appointments-list.ts` — Agregada suscripción a Realtime
  - Suscribe al canal `notifications:{businessId}`
  - Escucha eventos `appointment.created` y `appointment.rescheduled`
  - Dispara `fetchAppointments()` automáticamente para refrescar
  - Implementado con patrón useEffect + cleanup (remover suscripción al desmontar)

**Beneficios:**
- Sincronización en tiempo real entre WhatsApp y Dashboard
- UX mejorada: sin fricción de sincronización manual
- Baseline para futuras features Realtime en el Dashboard

**Referencias:**
- [WHATSAPP_AI_ARCHITECTURE.md](docs/WHATSAPP_AI_ARCHITECTURE.md) — Sección 5 (pipeline de notificaciones actualizado)
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 6 (pipeline dual)

---

#### Ajuste 2: Precisión en la Lógica de Cancelación de Citas

El agente de WhatsApp ahora **distingue explícitamente** entre cancelar una cita única vs múltiples citas, evitando asupciones ambiguas.

**Cambios técnicos:**

1. **`supabase/functions/process-whatsapp/context-fetcher.ts`**
   - Extended lookback para `getActiveAppointments()` de "ahora" a "4 horas atrás"
   - Justificación: Permite detectar citas que ya iniciaron (mismo día, para cancelación post-inicio)
   - Cambio: `const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()`

2. **`supabase/functions/process-whatsapp/prompt-builder.ts`**
   - Sección CANCELACIÓN reescrita con criterios explícitos:
     - **Cita única** (exactamente 1): Identifica + propone directamente → `¿Confirmas que la cancele?`
     - **Múltiples citas** (2 o más): Lista todas + pregunta cuál → nunca asume
     - **Confirmación obligatoria**: JAMÁS llama `cancel_booking` sin confirmación del cliente
   - Tres puntos numéricos claros + ejemplo de wording para cada caso

3. **`supabase/functions/process-whatsapp/tool-executor.ts`**
   - Función `cancel_booking()` — Agregado `sanitizeUUID()` explícito al inicio
   - Mensajes de error mejorados con contexto y guía (refiere al listado CITAS ACTIVAS)
   - Errores ahora es más conversacionales para que el LLM pueda recuperarse

**Beneficios:**
- Cancelaciones más confiables, especialmente en imprecisión del cliente ("cancela mi cita del lunes")
- Previene cancelaciones accidentales (nunca asume si hay múltiples)
- Mejor UX: citas activas de 4h atrás siguen cancelables (casos reales: "quiero cancelar la que tengo en 20 min")

**Riesgos mitigados:**
- Cancelación incorrecta de cita (la cita equivocada)
- No detectar citas same-day pasadas la hora de inicio

**Referencias:**
- [WHATSAPP_AI_ARCHITECTURE.md](docs/WHATSAPP_AI_ARCHITECTURE.md) — Sección 2 (guardrails hardening actualizado)
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 4 (WhatsApp Agent, contexto extendido)

---

## [0.2.0] — 2026-04-19

### Agregado

#### Voice Assistant Asíncrono para el Dashboard

Implementación de un asistente de voz en el Dashboard usando **QStash para orquestación asíncrona** + **Redis para estado de jobs** + **Deepgram Aura para TTS**.

**Arquitectura:**
```
FAB (Voice Button)
    ↓ [Pulsa grabar]
STT (Groq Whisper) + enqueue a QStash
    ↓
route.ts: submit → jobStore.update(status: 'pending')
    ↓
QStash: espera a que worker esté disponible
    ↓
worker/route.ts: LLM orchestration + TTS synthesis
    ↓
jobStore.update(status: 'completed', resultText, resultAudioUrl)
    ↓
FAB: polling desde status/route.ts cada 500ms
    ↓ [Cuando completado]
Reproducir audioUrl + mostrar texto
```

**Archivos nuevos:**
- `app/api/assistant/voice/route.ts` — Submit endpoint: STT + enqueue
- `app/api/assistant/voice/worker/route.ts` — QStash worker: orchestration + TTS
- `app/api/assistant/voice/status/route.ts` — Polling endpoint: job status check
- `lib/ai/job-store.ts` — Redis-backed job store con TTL 24h

**Archivos modificados:**
- `components/dashboard/voice-assistant-fab.tsx` — Async flow con confirmation audio + polling
- `lib/ai/agents/dashboard/config.ts` — Integration del orchestrator
- `lib/ai/orchestrator/execution-engine.ts` — Support para action responses

**Características:**
- Retry automático via QStash (hasta 4 intentos)
- Fallback a texto si TTS falla
- Progress audio (tono confirmación)
- Contador de intentos visible

**Test coverage:**
- `__tests__/api/assistant/voice/` — Suite de 28 tests (Vitest)
- E2E: `tests/voice-assistant.spec.ts` — Playwright (FAB drag, record, play audio)

**Referencias:**
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 12 (Voice Assistant Async)
- [README.md](README.md) — Módulo #5

---

## [0.1.0] — 2026-04-18

Base histórica documentada. Includes:

### Funcionalidades Base

- **Agente de IA WhatsApp** — ReAct loop con Groq Llama 3
  - Booking: agendar, cancelar, reagendar citas
  - Audio: Whisper transcription + TTS (Deepgram)
  - Multi-tenant: slug routing + sesión
  - Rate limiting: 6 capas de seguridad

- **Agente de IA Dashboard** — Orquestador de conversación
  - Citas: confirmar, cancelar, reagendar, buscar disponibilidad
  - Clientes: crear, buscar, historial
  - Finanzas: ingresos, proyecciones, reportes
  - Permisos: RBAC por rol (owner, employee, external)
  - Modelos: 8b primario, 70b fallback

- **Notificaciones Dual**
  - Dueño: WhatsApp directo + PWA push + DB
  - Cliente: WhatsApp branded confirmations
  - Idempotencia: event_id determinista

- **Auth + Security**
  - Supabase Auth + Passkeys (WebAuthn)
  - Login rate limiting: 3 intentos → 5 min lockout
  - Session timeout: 30 min inactividad + 12h absoluto
  - RLS multi-tenant

- **Observabilidad**
  - Sentry: error tracking + breadcrumbs
  - Helicone: LLM cost tracking per tenant
  - Dead Letter Queue: WhatsApp message recovery
  - System Pulse: founder-only admin dashboard

- **i18n**
  - 6 idiomas: Español, English, Français, Deutsch, Italiano, Português
  - next-intl integration

- **Testing**
  - Vitest: 142+ unit tests
  - Playwright: E2E tests para voice, auth, appointments
  - pgTAP: 45+ RLS security tests en PostgreSQL

### Tech Stack

- Frontend: Next.js 15 (App Router), React 19, TailwindCSS, Framer Motion
- Backend: Vercel (Node.js) + Supabase Edge Functions (Deno)
- Database: Supabase PostgreSQL + Realtime
- LLM: Groq (Llama 3.1-8b, Llama 3.3-70b, Whisper)
- Queue: Upstash QStash + Redis
- Deploy: Vercel + Supabase

---

## Convenciones de Versioning

- **0.x.y** — Fase de desarrollo activo (pre-1.0)
- **0.MAJOR.0** — Feature releases (new capabilities)
- **0.x.MINOR** — Bug fixes, small improvements
- **0.x.PATCH** — Docs, refactor (no feature)

---

## Cómo Contribuir

1. Cada feature nueva genera un versioning bump
2. Todos los cambios técnicos deben reflejarse aquí ANTES de ser mergeados
3. Las PRs deben incluir una línea de CHANGELOG draft

---

## Links de Referencia

- [Roadmap y ADRs](docs/architecture/ARCHITECTURE_DECISIONS.md)
- [Guía de Testing](TESTING_GUIDE.md)
- [Seguridad](docs/security/SECURITY_AND_RATE_LIMITS.md)
