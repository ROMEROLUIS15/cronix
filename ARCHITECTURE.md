# ARCHITECTURE.md — Cronix

> Documento de referencia técnica para desarrolladores.
> Todas las rutas y nombres de funciones fueron verificados contra el código real.
> Última actualización: **2026-04-24** — Cambios: Calendar Visibility + Cancellation Precision + Voice Assistant

---

## Índice

1. [Principios de Diseño](#1-principios-de-diseño)
2. [Separación de Runtimes](#2-separación-de-runtimes)
3. [Capa de IA — Dashboard Agent](#3-capa-de-ia--dashboard-agent)
4. [Capa de IA — WhatsApp Agent](#4-capa-de-ia--whatsapp-agent)
5. [Comparativa de Agentes](#5-comparativa-de-agentes)
6. [Pipeline de Notificaciones Dual](#6-pipeline-de-notificaciones-dual)
7. [Sistema de Rate Limiting de Login](#7-sistema-de-rate-limiting-de-login)
8. [Gestión de Sesiones](#8-gestión-de-sesiones)
9. [Multi-tenancy y Seguridad](#9-multi-tenancy-y-seguridad)
10. [Flujo de Datos Completo](#10-flujo-de-datos-completo)
11. [Decisiones Arquitectónicas (ADRs)](#11-decisiones-arquitectónicas-adrs)
12. [Voice Assistant Asíncrono (Dashboard)](#12-voice-assistant-asíncrono-dashboard)

---

## 1. Principios de Diseño

| Principio | Aplicación en Cronix |
|---|---|
| **SoC estricta** | UI ↔ Lógica ↔ Datos nunca en el mismo archivo |
| **Agnosticismo de runtime** | Cada agente de IA vive en su propio runtime (Node.js vs Deno) sin dependencias cruzadas |
| **Fail-safe** | Notificaciones y rate limiting fallan abiertos (fail-open); el booking no se interrumpe |
| **Idempotencia** | Cada evento tiene un `eventId` determinista; duplicados se descartan sin error |
| **Type-First** | `noUncheckedIndexedAccess: true`; no hay `any`; todos los estados tienen tipo definido |
| **SSOT** | Estado de conversación vive exclusivamente en `StateManager`; la UI deriva de él |

---

## 2. Separación de Runtimes

Cronix corre en **dos runtimes físicamente distintos** que nunca se importan entre sí:

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│  RUNTIME A: Node.js (Vercel)        │     │  RUNTIME B: Deno (Supabase Edge)    │
│                                     │     │                                     │
│  Next.js App Router                 │     │  supabase/functions/                 │
│  lib/ai/agents/dashboard/           │     │  process-whatsapp/                  │
│  lib/ai/orchestrator/               │     │  whatsapp-webhook/                  │
│  lib/ai/providers/groq-provider.ts  │     │  whatsapp-service/                  │
│  lib/rate-limit/redis-rate-limiter  │     │  cron-reminders/                    │
│  lib/notifications/                 │     │                                     │
│                                     │     │  Sin imports de Next.js/Node.       │
│  Usa: @upstash/redis, @supabase/ssr │     │  Usa: Deno.env, fetch nativo, Deno  │
└─────────────────────────────────────┘     └─────────────────────────────────────┘
            │                                             │
            └──────────────── Supabase DB ────────────────┘
                              (fuente de verdad compartida)
```

**¿Por qué esta separación?**
- Las Edge Functions de Deno no pueden importar módulos Node.js (`next/server`, `@supabase/ssr`, etc.)
- El código del agente WhatsApp (`groq-client.ts`, `tool-executor.ts`) usa `Deno.env` directamente
- Cambiar un agente no puede romper el otro por construcción

---

## 3. Capa de IA — Dashboard Agent

### Archivos físicos

```
lib/ai/
├── agents/
│   └── dashboard/
│       ├── config.ts      ← Configuración del agente (tier, maxIterations)
│       ├── prompt.ts      ← System prompt del dashboard
│       └── tools.ts       ← Tool definitions para el owner
├── orchestrator/
│   ├── ai-orchestrator.ts ← Facade: ÚNICO entry point para channel adapters
│   ├── decision-engine.ts ← Análisis de input → Decision
│   ├── execution-engine.ts← Ejecuta Decision → ExecutionResult + ReAct loop
│   ├── state-manager.ts   ← Carga/persiste ConversationState
│   ├── strategy.ts        ← Permisos por rol (owner, employee, external)
│   ├── event-dispatcher.ts← Fire-and-forget de AppointmentEvents
│   ├── events.ts          ← Tipos de eventos tipados
│   └── types.ts           ← AiInput, AiOutput, Decision, ConversationState
├── providers/
│   └── groq-provider.ts   ← ILlmProvider + ISttProvider → Groq
└── tools/
    ├── appointment.tools.ts
    ├── client.tools.ts
    ├── finance.tools.ts
    └── crm.tools.ts
```

### Configuración del agente (`dashboard/config.ts`)

```typescript
export const DASHBOARD_AGENT_CONFIG = {
  llmTier: 'quality' as const,  // 'quality' → llama-3.1-8b-instant + fallback llama-3.3-70b-versatile
  maxReactIterations: 3,        // Máximo de round-trips LLM+tool por turno
} as const
```

### Modelos por tier (`groq-provider.ts`)

```typescript
const MODEL_BY_TIER = {
  quality: { primary: 'llama-3.1-8b-instant', fallback: 'llama-3.3-70b-versatile' },
  fast:    { primary: 'llama-3.1-8b-instant', fallback: 'llama-3.3-70b-versatile' },
}
```

> **Nota de diseño:** 8b como primario por estabilidad y rate limits. 70b es fallback cuando 8b falla,
> NO primario. La mejora de precisión viene del prompt + memoria de entidades, no del modelo.

### Flujo del Orchestrator Pattern

```
Channel Adapter (componente React / API route)
    │
    ▼
AiOrchestrator.process(AiInput)          ← ÚNICO entry point
    │
    ├─► StateManager.load(userId, businessId)
    │       └─► ConversationState { flow, draft, history, turnCount, lastAction }
    │
    ├─► DecisionEngine.analyze(input, state)
    │       └─► Decision { type: 'execute_immediately' | 'reason_with_llm' | ... }
    │
    ├─► ExecutionEngine.execute(decision, state, input)
    │       │
    │       ├─ 'execute_immediately'  → ToolExecutor.execute() → DB
    │       ├─ 'continue_collection' → Solicita datos faltantes
    │       ├─ 'await_confirmation'  → Genera resumen y espera "sí"
    │       ├─ 'answer_query'        → ToolExecutor.execute() → read-only
    │       └─ 'reason_with_llm'    → Bucle ReAct (hasta maxReactIterations)
    │               └─► LlmProvider.chat() → tool_calls → ToolExecutor → feed back
    │
    ├─► StateManager.persist(nextState)
    │
    └─► AiOutput { text, actionPerformed, toolTrace, tokens, history }
```

### Guards en el ExecutionEngine

El `ExecutionEngine` implementa 4 capas de protección antes de enviar texto al usuario:

1. **Authorization guard** — `strategy.canExecute(toolName)` verifica permisos por rol
2. **Write-before-confirm guard** — Si `state.flow !== 'awaiting_confirmation'` y la estrategia requiere confirmación, intercepta y presenta resumen antes de ejecutar
3. **UUID lock guard** — Campos UUID en `state.draft` no pueden ser sobreescritos por el LLM (previene substitución silenciosa de service_id)
4. **Hallucination guards:**
   - Si el LLM dice "agendé la cita" sin haber llamado `confirm_booking` → respuesta bloqueada
   - Si el LLM dice "hay disponibilidad" sin haber llamado `get_available_slots` → respuesta bloqueada
   - `sanitizeOutput()` + `containsInternalSyntax()` → último guard antes de devolver texto

---

## 4. Capa de IA — WhatsApp Agent

### Archivos físicos (`supabase/functions/process-whatsapp/`)

```
process-whatsapp/
├── index.ts             ← Entry point Deno Edge Function
├── message-handler.ts   ← Pipeline completo (6 capas de seguridad)
├── ai-agent.ts          ← runAgentLoop() + transcribeAudio()
├── groq-client.ts       ← callLlm() + modelos + key pooling
├── tool-executor.ts     ← executeToolCall() + BOOKING_TOOLS schema (validación mejorada)
├── notifications.ts     ← emitBookingEvent() + sendClientBookingConfirmation()
├── time-utils.ts        ← localTimeToUTC() + utcToLocalParts()
├── prompt-builder.ts    ← buildSystemPrompt() con contexto RAG + cancelación explícita
├── business-router.ts   ← Resolución multi-tenant (slug/sesión)
├── context-fetcher.ts   ← Parallelized context queries (4h lookback para same-day cancel)
├── appointment-repo.ts  ← createAppointment(), rescheduleAppointment(), cancelAppointmentById()
├── guards.ts            ← Rate limits, circuit breaker, token quota
├── security.ts          ← verifyQStash() + sanitizeMessage()
├── audit.ts             ← Escribe eventos en wa_audit_logs (conversación history)
├── database.ts          ← Helper functions para DB access
├── types.ts             ← BusinessRagContext, MetaWebhookPayload, etc.
├── db-client.ts         ← Singleton Supabase client para Deno
└── whatsapp.ts          ← sendWhatsAppMessage(), downloadMediaBuffer()
```

### Modelos usados

```typescript
// groq-client.ts
export const SMALL_MODEL   = 'llama-3.1-8b-instant'     // decision loop + tool calling
export const LARGE_MODEL   = 'llama-3.3-70b-versatile'  // respuesta empática final
export const WHISPER_MODEL = 'whisper-large-v3-turbo'   // transcripción de notas de voz
export const MAX_STEPS     = 3                           // máximo iteraciones ReAct
```

### Key Pooling

`LLM_API_KEY` acepta múltiples claves separadas por coma. En caso de `HTTP 429` (rate limit), el sistema pasa automáticamente a la siguiente clave sin interrumpir la petición.

```typescript
const apiKeys = apiKeysStr.split(',').map(k => k.trim()).filter(Boolean)
for (let i = 0; i < apiKeys.length; i++) {
  // Si 429 y hay más keys → continue (siguiente key)
  // Si 429 y no hay más → throw LlmRateLimitError → QStash reintenta
}
```

### Pipeline de Seguridad (orden de ejecución)

```
Mensaje WhatsApp recibido
    │
    1. QStash signature (HMAC-SHA256)            ← verifyQStash()
    2. Message rate limit (10 msg/60s/phone)     ← checkMessageRateLimit()
    3. Business aggregate quota (50 msg/60s)     ← checkBusinessUsageLimit()
    4. Daily token quota (configurable/negocio)  ← checkTokenQuota()
    5. Message sanitization (anti-injection)     ← sanitizeMessage()
    6. Booking rate limit (5 activos/24h/client) ← checkBookingRateLimit()
```

### Contexto de Citas Activas — Lookback Extendido (`context-fetcher.ts`)

Desde 2026-04-24, `getActiveAppointments()` incluye un **lookback de 4 horas** para detectar citas que ya han iniciado:

```typescript
const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
```

**Motivo:** Permite al cliente cancelar citas que ya pasaron la hora de inicio (casos reales: "quiero cancelar la que tengo ahora en 20 min", "la cita de hace poco"). Sin este lookback, solo se veían citas futuras.

**Impacto:** La lógica de cancelación ahora puede preguntar "¿Cancelo tu cita del 24 de abril a las 3:00 pm?" incluso si ya son las 3:15 pm (si la cita de 1 hora aún no terminó).

---

### Lógica de Cancelación — Criterios Explícitos (desde 2026-04-24)

El prompt del sistema ahora distingue explícitamente entre dos escenarios:

**1. Cita única (exactamente 1 activa):**
```
Identifica la cita y propone:
"¿Confirmas que la cancele?"
```

**2. Múltiples citas (2 o más activas):**
```
NUNCA asumas cuál cancelar.
Lista todas: "Tienes estas citas: [lista]. ¿Cuál deseas cancelar?"
Cuando cliente indique → propón: "¿Confirmas?"
```

Esto previene cancelaciones accidentales de la cita equivocada.

---

### Gestión de Timezone (`time-utils.ts`)

El LLM siempre recibe y devuelve horas en **tiempo local del negocio** (IANA timezone almacenado en `businesses.timezone`). La conversión a UTC ocurre en `tool-executor.ts` justo antes de escribir en DB:

```
LLM dice: "15:00" (hora local Colombia)
    ↓
sanitizeTime("15:00") → "15:00" (HH:mm 24h validado)
    ↓
localTimeToUTC("2026-04-24", "15:00", "America/Bogota")
    → Two-step DST-aware: Intl.DateTimeFormat → fallback iterativo
    → "2026-04-24T20:00:00.000Z"
    ↓
DB stores UTC: start_at = "2026-04-24T20:00:00.000Z"
    ↓
Notificaciones: utcToLocalParts("...Z", "America/Bogota") → { date: "2026-04-24", time: "15:00" }
```

---

## 5. Comparativa de Agentes

| Aspecto | Dashboard Agent | WhatsApp Agent |
|---|---|---|
| **Runtime** | Node.js (Next.js/Vercel) | Deno (Supabase Edge) |
| **Entry point** | `AiOrchestrator.process()` | `handleMessage()` en `message-handler.ts` |
| **Modelo primario** | `llama-3.1-8b-instant` | `llama-3.1-8b-instant` |
| **Modelo fallback** | `llama-3.3-70b-versatile` | `llama-3.3-70b-versatile` |
| **Max iteraciones** | 3 (configurable en `config.ts`) | 3 (constante `MAX_STEPS`) |
| **Audio/STT** | `GroqProvider.transcribe()` | `transcribeAudio()` con `whisper-large-v3-turbo` |
| **Tenant routing** | `businessId` en `AiInput` | Slug → sesión → fallback |
| **Confirmación** | Strategy pattern (rol del usuario) | Siempre explícita del cliente |
| **Notificaciones** | `NotificationService` (Node.js) | `emitBookingEvent()` (Deno nativo) |
| **Circuit breaker** | `lib/ai/resilience.ts` | `guards.ts` (Upstash Redis) |

---

## 6. Pipeline de Notificaciones Dual y Dashboard Realtime

Cuando una cita es creada/modificada/cancelada, se disparan **dos notificaciones independientes y paralelas**, implementadas en `supabase/functions/process-whatsapp/notifications.ts`:

### Notificación al Dueño

```
emitCreatedEvent() / emitRescheduledEvent() / emitCancelledEvent()
    ↓
emitBookingEvent(AppointmentEvent)
    │
    1. checkEventExists(eventId) → ¿Ya existe en DB? → abort (idempotencia)
    2. saveNotificationToDB() → tabla `notifications` con event_id único
    3. pushToRealtime() → canal `notifications:{businessId}` → Dashboard en tiempo real
    4. sendOwnerWhatsApp() → Meta Graph API directa → WhatsApp del dueño
```

**ID determinista:** `${type}:${businessId}:${appointmentId}:${date}:${time}`
Garantiza que reintentos de QStash o bugs del LLM nunca generen notificaciones duplicadas.

### Notificación al Cliente

```
sendClientBookingConfirmation(clientPhone, 'created', businessName, serviceName, date, time)
    ↓
buildClientWhatsAppMessage() → Mensaje con branding del negocio
    ↓
sendWhatsAppMessage(clientPhone, message) → Meta Graph API
```

El cliente recibe un **mensaje formal separado** del reply conversacional del agente. Ejemplo:
> ✅ ¡Listo! Tu cita en *Peluquería Ana* ha sido agendada para el 24 de abril a las 3:00 pm para el servicio de *Corte de cabello*. ¡Te esperamos! 🎉

### Garantías del Pipeline

- **Fail-safe:** Cada canal falla silenciosamente con log. El booking ya fue completado.
- **Orden garantizado:** DB → Realtime → WhatsApp owner (WA solo si DB fue exitosa)
- **No-blocking:** Todas las notificaciones son fire-and-forget

### Dashboard Auto-Refresh via Realtime (desde 2026-04-24)

Desde 2026-04-24, el Dashboard **auto-refresca el calendario** cuando el agente de WhatsApp crea o reagenda citas.

**Implementación:**
- `app/[locale]/dashboard/appointments/hooks/use-appointments-list.ts`
  - useEffect suscribe a `supabase.channel('notifications:{businessId}')`
  - Escucha `broadcast` eventos: `appointment.created`, `appointment.rescheduled`
  - Dispara `fetchAppointments()` para refrescar la lista visible

**Flujo:**
```
WhatsApp Agent crea cita
    ↓
notifications.ts → emitCreatedEvent()
    ↓
supabase.from('notifications').insert({ event_id, type: 'created', businessId, ... })
    ↓
Supabase Realtime broadcast → canal 'notifications:{businessId}'
    ↓
Dashboard hook escucha evento
    ↓
fetchAppointments() → refrescar lista visible
```

**Beneficios:**
- Sincronización en tiempo real sin polling manual
- Sin necesidad de F5 para ver citas creadas por WhatsApp
- Baseline para futuras features Realtime

---

## 7. Sistema de Rate Limiting de Login

**Archivos involucrados:**
- `lib/rate-limit/redis-rate-limiter.ts` — funciones `getLoginFailures`, `incrementLoginFailures`, `resetLoginFailures`
- `lib/actions/auth.ts` — Server Action `login()` con política completa
- `app/[locale]/login/page.tsx` — UI con countdown y dots de intento

### Política

| Condición | Comportamiento |
|---|---|
| Intentos 1-2 | Error `invalid_credentials` + dot amarillo |
| Intento 3 | Lockout 5 minutos (`LOCKOUT_DURATION_MS = 5 * 60 * 1000`) |
| 6+ intentos | Lockout extendido 15 minutos (`EXTENDED_LOCKOUT_MS = 15 * 60 * 1000`) |
| Login exitoso | `resetLoginFailures(email)` → limpia Redis |

### Almacenamiento en Redis

```
Key format: lf:{email_lowercase}
Value: JSON { count: number, firstFailAt: number, lastFailAt: number }
TTL: 5 minutos (se renueva con cada fallo)
```

**Fallback en memoria:** Si Redis no está configurado (`UPSTASH_REDIS_REST_URL` ausente), el módulo usa un `Map` en memoria. Funciona en instancia única pero no es distribuido.

### Flujo del Server Action

```typescript
// lib/actions/auth.ts — login()
const existing = await getLoginFailures(email)
if (existing && existing.count >= 3) {
  const lockDuration = existing.count >= 6 ? 15min : 5min
  const lockoutEndsAt = existing.lastFailAt + lockDuration
  if (Date.now() < lockoutEndsAt) {
    return { error: 'locked', failedAttempts: existing.count, lockoutEndsAt }
  }
  // Expired → allow attempt
}

const { error } = await supabase.auth.signInWithPassword({ email, password })
if (error) {
  const state = await incrementLoginFailures(email)
  // ... retorna estado con count y lockoutEndsAt si aplica
}
// Success:
await resetLoginFailures(email)
redirect('/dashboard')
```

### UI (`app/[locale]/login/page.tsx`)

```
lockoutEndsAt (timestamp) recibido del Server Action
    ↓
useEffect → setInterval cada 1000ms
    → secondsLeft = Math.ceil((lockoutEndsAt - Date.now()) / 1000)
    → si secondsLeft === 0 → setLockoutEndsAt(null) → desbloqueo automático
    ↓
isLockedOut = lockoutEndsAt !== null && secondsLeft > 0
    ↓
<AttemptDots /> → 3 spans: ⚫→🟡 (1-2)→🔴 (3+)
<button disabled={isLockedOut}>
  {isLockedOut ? <><Lock /> 4:59</> : t('submit')}
</button>
```

---

## 8. Gestión de Sesiones

**Archivo:** `lib/middleware/with-session-timeout.ts`

Implementado como middleware de Next.js. Dos límites independientes:

| Límite | Duración | Trigger |
|---|---|---|
| Inactividad | 30 minutos | Sin actividad (scroll, clicks, requests) |
| Absoluto | 12 horas | Desde el último login, sin excepción |

Ambos se almacenan en cookies `httpOnly` y se verifican en cada request.

---

## 9. Multi-tenancy y Seguridad

### Aislamiento de datos

Cada query a Supabase incluye `business_id` explícito. No existe ningún endpoint que devuelva datos de múltiples tenants.

### Resolución de tenant (WhatsApp)

```
3-tier routing en business-router.ts:
1. Slug en mensaje (#mi-negocio) → getBusinessBySlug()
2. Sesión activa en DB → getSessionBusiness(senderPhone)
3. No encontrado → Landing message con URL de Cronix
```

### Validación de propiedad en booking

```typescript
// tool-executor.ts — reschedule_booking y cancel_booking
if (!aptDetails || aptDetails.business_id !== business.id) {
  return { error: 'UNAUTHORIZED: appointment does not belong to this business' }
}
const aptClientPhone = aptDetails.clients?.phone ?? null
if (aptClientPhone && !phoneMatches(aptClientPhone, sender)) {
  return { error: 'UNAUTHORIZED: appointment does not belong to this client' }
}
```

`phoneMatches()` maneja variantes de teléfono venezolano (58 0424 vs 58 424) y formatos internacionales.

---

## 10. Flujo de Datos Completo

```
CANAL WHATSAPP
═══════════════
Cliente → WhatsApp → Meta API
    ↓
whatsapp-webhook/index.ts
    ↓ [verifica webhook token]
QStash.publishJSON(process-whatsapp URL, body)
    ↓
process-whatsapp/index.ts → handleMessage(req)
    ↓
[6 capas de seguridad]
    ↓ [si audio]
Groq Whisper → texto
    ↓
business-router → tenant resuelto
    ↓
context-fetcher → [servicios, cliente, citas, slots] (paralelo)
    ↓
ai-agent.runAgentLoop(text, context)
    │
    ├── Iteration 1: SMALL_MODEL + BOOKING_TOOLS
    │       LLM → tool_call: confirm_booking { service_id, date, time }
    │       tool-executor:
    │           sanitizeUUID/Date/Time()
    │           localTimeToUTC(date, time, timezone)
    │           createAppointment() → Supabase
    │           emitCreatedEvent() → fire-and-forget
    │           sendClientBookingConfirmation() → fire-and-forget
    │
    ├── [Si SLOT_CONFLICT] Iteration 2: propone alternativas
    │
    └── Iteration final: LARGE_MODEL (tool_choice:'none') → respuesta empática
    ↓
sendWhatsAppMessage(sender, agentResult.text)
logInteraction() → audit table

CANAL DASHBOARD
═══════════════
Owner → React Component → AiOrchestrator.process(AiInput)
    ↓
DecisionEngine.analyze() → Decision
    ↓
ExecutionEngine.execute()
    │
    ├─ Tools: appointment.tools.ts → lib/appointments/ → Supabase
    ├─ Notificaciones: NotificationService → DB + Realtime
    └─ LLM: GroqProvider.chat() (llama-3.1-8b-instant)
    ↓
AiOutput → UI Component
```

---

## 11. Decisiones Arquitectónicas (ADRs)

### ADR-001: Dos agentes de IA separados (no compartidos)

**Decisión:** El agente de WhatsApp (`process-whatsapp/`) y el agente del Dashboard (`lib/ai/agents/dashboard/`) son implementaciones independientes con código propio, no un único agente reutilizado.

**Razón:**
- Runtimes incompatibles (Deno vs Node.js)
- Contexto de negocio diferente: el agente WhatsApp hace RAG de servicios/slots/historial del cliente; el dashboard tiene acceso a datos financieros y CRM
- Permisos y roles distintos
- Estrategia de confirmación distinta

**Trade-off:** Duplicación de lógica de prompts. Mitigado porque ambos usan el mismo LLM provider (Groq) y los mismos modelos.

---

### ADR-002: Upstash Redis como store de rate limiting (no Supabase)

**Decisión:** El tracking de fallos de login y el sliding window rate limiting usan Upstash Redis, no una tabla de Supabase.

**Razón:**
- Supabase tiene latencia de ~100-200ms por query; Redis <5ms
- Las Server Actions de login son hot-path crítico
- Redis TTL nativo simplifica la limpieza de datos expirados
- Funciona across Vercel instances (distribuido)

**Trade-off:** Dependencia adicional. Mitigado con fallback en memoria.

---

### ADR-003: QStash como cola para mensajes WhatsApp (no procesamiento síncrono)

**Decisión:** El webhook de Meta encola cada mensaje en QStash; el procesamiento ocurre de forma asíncrona en `process-whatsapp`.

**Razón:**
- Meta requiere respuesta HTTP en <5s; el agente ReAct puede tardar 8-15s
- QStash maneja reintentos automáticos ante rate limits de Groq (503 + Retry-After)
- Dead Letter Queue para mensajes que fallan definitivamente
- Desacopla ingestión de procesamiento

---

### ADR-004: Modelos LLM — 8B primario, 70B fallback

**Decisión:** `llama-3.1-8b-instant` es el modelo primario para tool calling; `llama-3.3-70b-versatile` es fallback y para respuestas empáticas finales.

**Razón:**
- 70B como primario causaba timeouts y rate limits en Groq free tier
- 8B es más estable y rápido para tool calling estructurado
- La calidad de respuesta mejora con mejor prompt + memoria, no con modelo más grande
- 70B se reserva para el paso conversacional final (sin tools)

---

### ADR-005: Idempotencia por eventId determinista en notificaciones

**Decisión:** Los `eventId` de notificaciones se construyen como `${type}:${businessId}:${appointmentId}:${date}:${time}` en lugar de `crypto.randomUUID()`.

**Razón:**
- QStash puede reintentar la misma petición múltiples veces
- El bucle ReAct puede llamar el mismo tool en iteraciones diferentes
- Con UUID aleatorio: el dueño recibía 2-3 WhatsApp por cada cita
- Con ID determinista: exactamente UN mensaje por evento, sin importar reintentos

---

## 12. Voice Assistant Asíncrono (Dashboard)

El Dashboard incluye un **asistente de voz flotante** que usa **QStash para orquestación asíncrona**, **Redis para persistencia de estado**, y **Deepgram Aura para síntesis de voz**.

### Arquitectura de alto nivel

```
┌──────────────────────────────────┐
│  FAB (Floating Action Button)    │
│  └─ click → open recording       │
└───────────┬──────────────────────┘
            │ [User speaks]
            ↓
    ┌───────────────────────┐
    │ Groq Whisper STT      │
    │ (whisper-large-v3)    │
    └───────┬───────────────┘
            │ transcript
            ↓
    ┌───────────────────────┐
    │ app/api/assistant/    │
    │   voice/route.ts      │
    │                       │
    │ 1. Validate input     │
    │ 2. jobStore.create()  │
    │ 3. QStash.publish()   │
    │ 4. Return job_id      │
    └───────┬───────────────┘
            │ HTTP 200 { job_id, status: 'pending' }
            ↓
    ┌───────────────────────┐
    │ FAB polling loop      │
    │ Every 500ms:          │
    │ GET /api/assistant/   │
    │   voice/status/       │
    │   ?job_id=XXX         │
    └───────┬───────────────┘
            │ [Mientras status = 'pending']
            │
            │ [QStash ejecuta worker]
            │ ↓
            │ ┌───────────────────────────┐
            │ │ app/api/assistant/voice/  │
            │ │   worker/route.ts         │
            │ │                           │
            │ │ 1. Load business context  │
            │ │ 2. AI Orchestrator        │
            │ │ 3. Execute tools          │
            │ │ 4. Deepgram TTS           │
            │ │ 5. jobStore.update()      │
            │ │    (status: 'completed')  │
            │ └───────────────────────────┘
            │
            │ [Polling recibe status: 'completed']
            ↓
    ┌───────────────────────┐
    │ FAB displays result   │
    │ - Show text response  │
    │ - Play audioUrl       │
    └───────────────────────┘
```

### Archivos involucrados

| Archivo | Responsabilidad |
|---|---|
| `app/api/assistant/voice/route.ts` | HTTP POST: recibe audio → STT → enqueue QStash |
| `app/api/assistant/voice/worker/route.ts` | QStash worker: orchestration + TTS → Redis update |
| `app/api/assistant/voice/status/route.ts` | HTTP GET: polling → jobStore.get(job_id) |
| `lib/ai/job-store.ts` | Redis wrapper: job CRUD + TTL 24h |
| `components/dashboard/voice-assistant-fab.tsx` | UI: drag FAB, recording, polling, audio playback |

### Estado de Job en Redis

```javascript
// jobStore key format: "voice-job:{job_id}"
{
  "job_id": "uuid-12345",
  "user_id": "user-xyz",
  "business_id": "biz-abc",
  "status": "completed" | "processing" | "failed" | "pending",
  "resultText": "string (la respuesta del agente)",
  "resultAudioUrl": "https://... (MP3 de TTS)",
  "error": "null | error message",
  "actionPerformed": boolean,
  "createdAt": "ISO timestamp",
  "attempts": 1-3 (counter para reintentos QStash)
}
```

### Retry Resilience (QStash)

| Escenario | Comportamiento |
|---|---|
| Orchestrator falla en attempt 1-2 | QStash espera backoff → reintentos automáticos (máx 4 total) |
| Max attempts (3) excedido | jobStore.update({ status: 'failed', error: 'max_attempts_exceeded' }) + audio error |
| LLM API key no configurado | Respuesta: "El servicio de IA no está configurado" |
| TTS falla | Text-only result (sin audioUrl) |
| Database/Redis indisponible | Audible error "Hubo un problema procesando tu solicitud" |

### Tokenización y Cuota

- Cada sesión voice comparte la **cuota diaria de tokens** del negocio
- `checkTokenQuota(business_id)` ejecuta **antes** de comenzar orchestration
- Si excede → error: "Has alcanzado el límite diario del asistente"

---
