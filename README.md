<div align="center">

# 🕐 Cronix

**Plataforma SaaS de agendamiento inteligente para negocios de servicios**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-green?logo=supabase)](https://supabase.com)
[![Groq](https://img.shields.io/badge/Groq-Llama%203-orange)](https://groq.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://vercel.com)

</div>

---

## ¿Qué es Cronix?

Cronix permite a negocios de servicios (peluquerías, clínicas, estudios, spas) recibir reservas 24/7 a través de **WhatsApp**, con un **agente de IA** que entiende lenguaje natural —incluyendo notas de voz—, gestiona conflictos de horario, y envía confirmaciones automáticas tanto al negocio como al cliente.

La plataforma incluye un **dashboard web** con su propio agente de IA para que el dueño gestione su agenda, clientes y finanzas desde el navegador.

---

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend / SSR | Next.js (App Router) | 15 |
| UI | React + TailwindCSS + Framer Motion | 19 / 3 / 12 |
| Base de datos | Supabase (PostgreSQL + Realtime) | 2.98 |
| Auth | Supabase Auth + Passkeys (WebAuthn) | — |
| Edge Functions | Deno (Supabase Edge Functions) | — |
| IA / LLM | Groq — `llama-3.1-8b-instant` / `llama-3.3-70b-versatile` | — |
| STT / Audio | Groq Whisper — `whisper-large-v3-turbo` | — |
| Rate Limiting / Cache | Upstash Redis + QStash | 1.37 / 2.10 |
| Internacionalización | next-intl (6 idiomas) | 4.9 |
| Monitoreo | Sentry + Helicone | — |
| Testing | Vitest + Playwright | 3 / 1.59 |
| PWA | next-pwa | 10.2 |

**Idiomas soportados:** Español · English · Français · Deutsch · Italiano · Português

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│  Cliente Web (Next.js 15 / App Router)                          │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │  Dashboard (Owner)  │    │  Página de Login              │    │
│  │  + Floating AI Chat │    │  Rate Limit UI (countdown)    │    │
│  └────────┬────────────┘    └──────────────────────────────┘    │
└───────────┼─────────────────────────────────────────────────────┘
            │ Server Actions (Next.js)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  lib/actions/auth.ts          lib/ai/orchestrator/              │
│  ├─ Login + Rate Limit        ├─ AiOrchestrator (facade)        │
│  ├─ Google OAuth              ├─ DecisionEngine                  │
│  └─ Signout                   ├─ ExecutionEngine                 │
│                               └─ StateManager                   │
│  lib/ai/agents/dashboard/     lib/rate-limit/                   │
│  ├─ config.ts (tier: quality) └─ redis-rate-limiter.ts          │
│  ├─ prompt.ts                                                   │
│  └─ tools.ts                                                    │
└───────────┬─────────────────────────────────────────────────────┘
            │ Supabase Client (SSR)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL + Realtime + Auth + Storage)              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Edge Functions (Deno runtime)                             │ │
│  │  ├─ process-whatsapp/   ← WhatsApp AI Agent               │ │
│  │  ├─ whatsapp-webhook/   ← Meta webhook + QStash enqueue   │ │
│  │  ├─ whatsapp-service/   ← WA transport layer              │ │
│  │  ├─ cron-reminders/     ← Recordatorios automáticos       │ │
│  │  ├─ push-notify/        ← Push notifications              │ │
│  │  └─ embed-text/         ← Embeddings vectoriales          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │
┌───────────┴──────────────────────┐
│  Upstash Redis                   │
│  ├─ Login failure tracking       │
│  ├─ Sliding window rate limiting │
│  └─ QStash retry state           │
└──────────────────────────────────┘
```

---

## Módulos Principales

### 1. Agente de IA para WhatsApp

**Ubicación:** `supabase/functions/process-whatsapp/`

Agente autónomo que corre en Deno. Recibe mensajes de WhatsApp encolados por QStash y ejecuta un **bucle ReAct** con Groq para agendar, cancelar y reagendar citas.

**Archivos clave:**

| Archivo | Responsabilidad |
|---|---|
| `index.ts` | Entry point del Edge Function |
| `message-handler.ts` | Pipeline completo de seguridad → contexto → agente |
| `ai-agent.ts` | Bucle ReAct con `llama-3.1-8b-instant` + `llama-3.3-70b-versatile` |
| `groq-client.ts` | Cliente HTTP de Groq + Whisper + Key Pooling |
| `tool-executor.ts` | Ejecutor de herramientas: `confirm_booking`, `reschedule_booking`, `cancel_booking` |
| `notifications.ts` | Doble notificación: dueño (WA + DB) y cliente (WA branded) |
| `time-utils.ts` | Conversión UTC ↔ Local DST-aware con IANA timezones |
| `prompt-builder.ts` | Construcción dinámica del system prompt con contexto RAG |
| `business-router.ts` | Resolución multi-tenant: slug → sesión → fallback |
| `guards.ts` | Rate limits, circuit breaker, token quota |
| `security.ts` | Verificación QStash + sanitización anti-prompt-injection |

### 2. Agente de IA del Dashboard

**Ubicación:** `lib/ai/agents/dashboard/` + `lib/ai/orchestrator/`

Agente web integrado en el dashboard del dueño. Comparte la arquitectura de orquestación pero opera en el runtime de Next.js (Node.js).

**Archivos clave:**

| Archivo | Responsabilidad |
|---|---|
| `lib/ai/agents/dashboard/config.ts` | `llmTier: 'quality'`, `maxReactIterations: 3` |
| `lib/ai/agents/dashboard/prompt.ts` | System prompt del agente de dashboard |
| `lib/ai/agents/dashboard/tools.ts` | Tool definitions para el dashboard |
| `lib/ai/orchestrator/ai-orchestrator.ts` | Facade principal: estado → decisión → ejecución |
| `lib/ai/orchestrator/decision-engine.ts` | Análisis de intent y extracción de entidades |
| `lib/ai/orchestrator/execution-engine.ts` | Bucle ReAct + notificaciones + guards |
| `lib/ai/orchestrator/state-manager.ts` | Persistencia del estado de conversación |
| `lib/ai/providers/groq-provider.ts` | Wrapper de Groq: chat, stream, STT |

### 3. Sistema de Rate Limiting de Login

**Ubicación:** `lib/rate-limit/redis-rate-limiter.ts` + `lib/actions/auth.ts`

Protección contra ataques de fuerza bruta a nivel de cuenta (por email, no por IP). Funciona distribuido entre todas las instancias de Vercel gracias a Upstash Redis.

### 4. Notificaciones

**Ubicación:** `lib/notifications/notification-service.ts`

Pipeline de notificaciones para el dashboard. Garantiza idempotencia mediante `event_id` único, persiste en DB antes de cualquier canal de entrega.

### 5. Voice Assistant Asíncrono (Dashboard)

**Ubicación:** `app/api/assistant/voice/` + `lib/ai/job-store.ts` + `components/dashboard/voice-assistant-fab.tsx`

Asistente de voz flotante en el Dashboard que usa **QStash para orquestación asíncrona**, **Redis para persistencia de estado**, y **Deepgram Aura para síntesis de voz**.

**Archivos clave:**

| Archivo | Responsabilidad |
|---|---|
| `app/api/assistant/voice/route.ts` | HTTP POST: recibe audio → STT (Groq Whisper) → enqueue QStash |
| `app/api/assistant/voice/worker/route.ts` | QStash worker: ejecuta LLM orchestration + TTS (Deepgram) |
| `app/api/assistant/voice/status/route.ts` | HTTP GET: polling endpoint que retorna job status desde Redis |
| `lib/ai/job-store.ts` | Redis wrapper: CRUD de jobs con TTL 24h |
| `components/dashboard/voice-assistant-fab.tsx` | UI: draggable FAB, recording, polling, audio playback |

**Flujo:**
1. Usuario pulsa FAB → abre recorder
2. `route.ts`: STT + enqueue a QStash → responde con `job_id`
3. FAB polling: GET `/api/assistant/voice/status?job_id=XXX` cada 500ms
4. QStash ejecuta `worker/route.ts`: LLM orchestration → TTS → jobStore update
5. Polling recibe `status: 'completed'` → muestra texto + reproduce audio

**Resilience:**
- QStash retries automáticos (max 4 intentos)
- Si TTS falla → texto-only response
- Token quota compartida con Dashboard agent
- Max attempts → audible error message

---

## Flujos de Usuario

### Agendamiento por WhatsApp (con voz)

```
Cliente envía mensaje (texto o nota de voz)
    ↓
Meta Webhook → whatsapp-webhook → QStash enqueue
    ↓
process-whatsapp (Deno Edge Function)
    ↓ [Si es audio]
Groq Whisper (whisper-large-v3-turbo) → texto transcrito
    ↓
Security: QStash signature + rate limit + sanitización
    ↓
Tenant routing: #slug → sesión DB → fallback landing
    ↓
Context fetch: servicios + cliente + citas activas + slots ocupados
    ↓
ReAct loop (llama-3.1-8b-instant):
  Iteración 1: LLM analiza → llama tool confirm_booking
  tool-executor:
    - Valida UUID, fecha, hora
    - localTimeToUTC() con DST correction
    - checkBookingRateLimit()
    - createAppointment() → Supabase DB
  ↓ [Si hay SLOT_CONFLICT: propone alternativas]
  Iteración 2 (si necesario): Respuesta empática (llama-3.3-70b-versatile)
    ↓
Notificaciones (fire-and-forget, idempotentes):
  → DB notifications table (event_id único)
  → Supabase Realtime broadcast → Dashboard owner
  → WhatsApp al dueño (Meta Graph API directa)
  → WhatsApp al cliente (branded confirmation)
    ↓
Respuesta conversacional al cliente
```

### Login con Rate Limiting

```
Usuario ingresa email + contraseña
    ↓
lib/actions/auth.ts (Server Action):
    1. getLoginFailures(email) → Redis / memory
    2. ¿count >= 3? → ¿lockoutEndsAt > now? → retorna { error:'locked', lockoutEndsAt }
    3. supabase.auth.signInWithPassword()
    4. ¿Error? → incrementLoginFailures(email)
       - count 1-2 → retorna { error: 'invalid_credentials', failedAttempts }
       - count >= 3 → retorna { error: 'locked', lockoutEndsAt: lastFailAt + 5min }
       - count >= 6 → lockoutEndsAt: lastFailAt + 15min
    5. ¿Éxito? → resetLoginFailures(email) → redirect('/dashboard')
    ↓
login/page.tsx (Client):
    - Dots de intento (⚫→🟡→🔴) con attemptsWarning i18n
    - Countdown setInterval cada 1s desde lockoutEndsAt
    - Botón → 🔒 4:59 (disabled, cursor not-allowed)
    - Link "Recuperar contraseña ahora" prominente durante bloqueo
```

---

## Seguridad

| Capa | Mecanismo |
|---|---|
| Login brute-force | Upstash Redis: 3 intentos = 5 min lockout, 6+ = 15 min |
| WhatsApp webhook | QStash signature verification (HMAC-SHA256) |
| Prompt injection | `sanitizeMessage()` en `security.ts` |
| Multi-tenant | Todas las queries incluyen `business_id` explícito |
| Output leak | `sanitizeOutput()` + `containsInternalSyntax()` en ExecutionEngine |
| Booking duplicates | `parallel_tool_calls: false` + idempotency `event_id` |
| Session | 30 min inactividad + 12h absoluto (`lib/middleware/with-session-timeout.ts`) |
| RLS | Row Level Security habilitado en todas las tablas sensibles |

---

## Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Upstash Redis (rate limiting distribuido)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Upstash QStash (cola de mensajes WhatsApp)
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# IA
LLM_API_KEY=                    # Groq API key(s), separados por coma para key pooling

# WhatsApp (Meta)
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=

# Opcional
HELICONE_API_KEY=               # Proxy observability para Groq
SENTRY_DSN=
```

---

## Comandos de Desarrollo

```bash
# Instalar dependencias
npm install

# Desarrollo local
npm run dev

# TypeScript check
npm run typecheck

# Tests unitarios
npm test

# Tests E2E (Playwright)
npm run test:e2e

# Tests de integración
npm run test:integration
```

---

## Estructura del Proyecto

```
cronix/
├── app/
│   ├── [locale]/                       # Rutas internacionalizadas (es, en, fr, de, it, pt)
│   │   ├── page.tsx                    # Landing page
│   │   ├── layout.tsx
│   │   ├── login/                      # Login + rate-limit UI + countdown
│   │   ├── register/                   # Registro de nuevos usuarios
│   │   ├── forgot-password/            # Recuperación de contraseña
│   │   ├── reset-password/             # Reset con token
│   │   ├── privacy/                    # Política de privacidad
│   │   ├── terms/                      # Términos de servicio
│   │   └── dashboard/                  # Área autenticada
│   │       ├── page.tsx                # Dashboard home (resumen del día)
│   │       ├── layout.tsx
│   │       ├── appointments/           # Gestión de citas
│   │       ├── clients/                # CRM de clientes
│   │       ├── services/               # Catálogo de servicios
│   │       ├── finances/               # Ingresos y reportes financieros
│   │       ├── reports/                # Reportes detallados
│   │       ├── settings/               # Configuración del negocio
│   │       ├── profile/                # Perfil del usuario
│   │       ├── team/                   # Gestión de equipo
│   │       ├── admin/                  # Panel de administración
│   │       ├── setup/                  # Onboarding inicial
│   │       ├── _client/                # Client components del dashboard
│   │       ├── _components/            # Server components del dashboard
│   │       └── _hooks/                 # Hooks específicos del dashboard
│   ├── api/                            # API routes de Next.js
│   │   └── assistant/voice/
│   │       ├── route.ts                # POST: STT + QStash enqueue
│   │       ├── worker/route.ts         # QStash worker: orchestration + TTS
│   │       └── status/route.ts         # GET: polling endpoint (job status)
│   └── auth/                           # Callbacks OAuth (Google, passkeys)
│
├── lib/
│   ├── actions/
│   │   ├── auth.ts                     # login, signInWithGoogle, signUpWithGoogle, signout
│   │   ├── voice-assistant.ts          # Server action del asistente de voz
│   │   ├── rate-limit-action.ts        # Server action para rate limiting de API
│   │   └── csrf-action.ts              # Generación de tokens CSRF
│   ├── ai/
│   │   ├── agents/
│   │   │   └── dashboard/
│   │   │       ├── config.ts           # llmTier: 'quality', maxReactIterations: 3
│   │   │       ├── prompt.ts           # System prompt del agente dashboard
│   │   │       └── tools.ts            # Tool definitions para el dashboard
│   │   ├── orchestrator/
│   │   │   ├── ai-orchestrator.ts      # Facade: ÚNICO entry point de channel adapters
│   │   │   ├── decision-engine.ts      # Análisis de intent → Decision
│   │   │   ├── execution-engine.ts     # Bucle ReAct + guards + notificaciones
│   │   │   ├── state-manager.ts        # Carga/persiste ConversationState
│   │   │   ├── strategy.ts             # Permisos por rol (owner, employee, external)
│   │   │   ├── event-dispatcher.ts     # Fire-and-forget de AppointmentEvents
│   │   │   ├── events.ts               # Tipos de eventos tipados
│   │   │   ├── orchestrator-factory.ts # Factory de producción
│   │   │   └── types.ts                # AiInput, AiOutput, Decision, ConversationState
│   │   ├── providers/
│   │   │   ├── groq-provider.ts        # ILlmProvider + ISttProvider → Groq
│   │   │   ├── deepgram-provider.ts    # Proveedor alternativo STT
│   │   │   ├── elevenlabs-provider.ts  # Text-to-speech
│   │   │   └── types.ts                # Interfaces de providers
│   │   ├── tools/
│   │   │   ├── appointment.tools.ts    # confirm_booking, cancel, reschedule
│   │   │   ├── client.tools.ts         # Búsqueda y gestión de clientes
│   │   │   ├── finance.tools.ts        # Consultas financieras
│   │   │   ├── crm.tools.ts            # Operaciones CRM
│   │   │   └── index.ts
│   │   ├── intent-router.ts            # Clasificación rápida de intents
│   │   ├── fuzzy-match.ts              # Matching aproximado de nombres/servicios
│   │   ├── session-store.ts            # Store de sesiones de conversación
│   │   ├── memory-service.ts           # Memoria de entidades del agente
│   │   ├── job-store.ts                # Redis-backed job store (voice assistant async)
│   │   ├── circuit-breaker.ts          # Circuit breaker para LLM
│   │   ├── output-shield.ts            # Sanitización de output del LLM
│   │   └── resilience.ts               # safeSTT(), safeLLM() con retry
│   ├── application/                    # Casos de uso de aplicación
│   ├── domain/
│   │   ├── errors/                     # Errores de dominio tipados
│   │   ├── repositories/               # Interfaces de repositorios
│   │   └── use-cases/                  # Casos de uso de dominio
│   ├── middleware/
│   │   ├── with-session-timeout.ts     # 30 min inactividad + 12h absoluto
│   │   ├── with-session.ts             # Verificación de sesión activa
│   │   ├── with-csrf.ts                # Validación CSRF
│   │   ├── with-rate-limit.ts          # Rate limiting de rutas
│   │   ├── with-user-status.ts         # Estado del usuario (activo/suspendido)
│   │   ├── with-request-id.ts          # Request ID para trazabilidad
│   │   └── compose.ts                  # Composición de middlewares
│   ├── notifications/
│   │   └── notification-service.ts     # Pipeline: DB → Realtime → WhatsApp
│   ├── rate-limit/
│   │   ├── redis-rate-limiter.ts       # Sliding window + login failure tracking
│   │   └── token-quota.ts              # Cuota de tokens por negocio
│   ├── repositories/                   # Implementaciones Supabase de repositorios
│   │   ├── SupabaseAppointmentRepository.ts
│   │   ├── SupabaseClientRepository.ts
│   │   ├── SupabaseBusinessRepository.ts
│   │   ├── SupabaseFinanceRepository.ts
│   │   ├── SupabaseServiceRepository.ts
│   │   ├── SupabaseUserRepository.ts
│   │   ├── SupabaseNotificationRepository.ts
│   │   └── SupabaseReminderRepository.ts
│   ├── services/
│   │   ├── whatsapp.service.ts         # Envío de mensajes WhatsApp (Next.js side)
│   │   ├── push-notify.service.ts      # Web push notifications
│   │   └── contact-picker.service.ts   # Selección de contactos del dispositivo
│   ├── security/                       # Utilidades de seguridad
│   ├── hooks/                          # React hooks compartidos
│   ├── supabase/                       # Clientes Supabase (server/client/admin)
│   ├── validations/                    # Schemas Zod
│   ├── utils/                          # Utilidades generales
│   ├── constants/                      # Constantes globales
│   ├── container.ts                    # IoC container
│   ├── cache.ts                        # Caching layer
│   └── logger.ts                       # Logger estructurado (Sentry-aware)
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/                    # Código compartido entre edge functions
│   │   ├── process-whatsapp/           # WhatsApp AI Agent (Deno, 20 archivos)
│   │   │   ├── ai-agent.ts             # runAgentLoop() + transcribeAudio()
│   │   │   ├── groq-client.ts          # callLlm() + key pooling + circuit breaker
│   │   │   ├── tool-executor.ts        # confirm/reschedule/cancel_booking
│   │   │   ├── notifications.ts        # Doble notificación: dueño + cliente
│   │   │   ├── time-utils.ts           # localTimeToUTC() + utcToLocalParts()
│   │   │   ├── prompt-builder.ts       # System prompt dinámico con RAG
│   │   │   ├── message-handler.ts      # Pipeline de 6 capas de seguridad
│   │   │   ├── business-router.ts      # Resolución multi-tenant
│   │   │   ├── context-fetcher.ts      # Queries paralelas de contexto
│   │   │   ├── appointment-repo.ts     # CRUD de citas en Supabase
│   │   │   ├── guards.ts               # Rate limits, circuit breaker, token quota
│   │   │   └── security.ts             # QStash signature + anti-injection
│   │   ├── whatsapp-webhook/           # Meta webhook receiver → QStash enqueue
│   │   ├── whatsapp-service/           # Transport layer de WhatsApp
│   │   ├── cron-reminders/             # Recordatorios automáticos (cron)
│   │   ├── embed-text/                 # Generación de embeddings vectoriales
│   │   └── push-notify/                # Web push notifications
│   └── migrations/                     # Migraciones SQL versionadas
│
├── components/
│   ├── ui/                             # Componentes base (botones, inputs, modals)
│   ├── dashboard/                      # Componentes específicos del dashboard
│   ├── layout/                         # Header, sidebar, footer
│   ├── admin/                          # Componentes de administración
│   └── hooks/                          # Hooks de componentes
│
├── messages/                           # Archivos i18n
│   ├── es.json                         # Español (base)
│   ├── en.json
│   ├── fr.json
│   ├── de.json
│   ├── it.json
│   └── pt.json
│
├── types/                              # Tipos TypeScript globales
├── i18n/                               # Configuración next-intl
├── public/                             # Assets estáticos + PWA manifest
├── __tests__/                          # Tests unitarios Vitest
├── tests/                              # Tests adicionales
├── middleware.ts                       # Composición de middlewares (auth + session + locale)
├── next.config.js
├── tailwind.config.ts
└── tsconfig.json
```

---

## Licencia

Propietario — © 2024-2026 Cronix. Todos los derechos reservados.
