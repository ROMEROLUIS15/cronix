<div align="center">

# Cronix

**Plataforma SaaS de agendamiento inteligente para negocios de servicios**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-green?logo=supabase)](https://supabase.com)
[![Groq](https://img.shields.io/badge/Groq-Llama%203-orange)](https://groq.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-1276%20passed-green)](./TESTING.md)

</div>

---

## ¿Qué es Cronix?

Cronix permite a negocios de servicios (peluquerías, clínicas, estudios, spas) recibir reservas 24/7 a través de **WhatsApp**, con un agente de IA que entiende lenguaje natural, gestiona conflictos de horario y envía confirmaciones automáticas.

La plataforma incluye un **dashboard web** con su propio asistente de voz para que el dueño gestione agenda, clientes y finanzas desde el navegador.

---

## Arquitectura

```
                    ┌──────────────────────────────┐
                    │          CHANNELS             │
                    │                              │
   Owner (voz) ────► DashboardBookingAdapter       │
                    │         ↓                   │
   Cliente (WA) ───► WhatsApp Adapter (Deno)       │
                    └─────────────┬────────────────┘
                                  │ TenantContext
                                  ▼
                    ┌──────────────────────────────┐
                    │  TenantEnforcer (security)   │
                    │  verifica ownership en DB    │
                    └─────────────┬────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────────┐
                    │       BookingEngine          │
                    │  (único core de negocio)     │
                    │  ├── Zod validation          │
                    │  ├── ClientResolver          │
                    │  ├── ServiceResolver         │
                    │  ├── localToUTC              │
                    │  └── UseCases               │
                    └─────────────┬────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────────┐
                    │       Repositories           │
                    │  (Supabase + RLS + cache)    │
                    └──────────────────────────────┘
```

**Principio clave**: ambos canales (Dashboard y WhatsApp) usan el mismo `BookingEngine`. La lógica de negocio nunca se duplica.

---

## Flujo de Ejecución (End-to-End)

```
1. Input del usuario (voz o texto)
2. STT: Deepgram (voz) → texto
3. DecisionEngine: fast-path o LLM?
   ├── Fast-path: detecta intento claro → ejecuta directo (0 tokens LLM)
   └── LLM path: Groq API → tool call → ejecutar tool
4. DashboardBookingAdapter.execute(toolName, args, userId, businessId)
5. TenantEnforcer.verify(businessId, userId) → TenantContext
6. BookingEngine.dispatch(ctx, toolName, args)
   ├── Zod: valida args
   ├── ClientResolver: nombre → UUID (fuzzy match)
   ├── ServiceResolver: nombre → UUID (4 estrategias)
   ├── localToUTC: convierte hora local → UTC
   └── UseCase.execute: conflict check → create
7. cache.invalidate(businessId, 'appointments')
8. Respuesta → TTS → audio al usuario
```

---

## Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Frontend | Next.js 15 + React 19 | Dashboard web |
| API | Next.js API Routes | Endpoints REST |
| AI LLM | Groq (Llama 3) | Razonamiento + tool calls |
| AI STT | Deepgram | Voz → texto |
| AI TTS | ElevenLabs | Texto → voz |
| DB | Supabase (PostgreSQL + RLS) | Datos + autenticación |
| Cache | Upstash Redis | Estado conversacional + cache |
| Edge | Supabase Edge Functions (Deno) | WhatsApp agent |
| Queue | QStash (Upstash) | Cola async para webhooks |
| Auth | Supabase Auth + Passkeys | Autenticación multifactor |
| Monitoreo | Sentry + Axiom | Errores + logs estructurados |
| Deploy | Vercel | Frontend + API |

---

## Árbol del Proyecto

```
cronix/
├── app/
│   ├── api/
│   │   ├── assistant/voice/      # Endpoints del asistente de voz
│   │   ├── webhooks/             # WhatsApp, NOWPayments webhooks
│   │   ├── passkey/              # Autenticación con passkeys
│   │   └── health/               # Health check
│   └── [locale]/                 # Páginas del dashboard (i18n)
│
├── lib/
│   ├── ai/
│   │   ├── core/                 # ← NÚCLEO (channel-agnostic)
│   │   │   ├── booking/
│   │   │   │   ├── BookingEngine.ts    # Único source of truth
│   │   │   │   ├── ClientResolver.ts   # Fuzzy name → UUID
│   │   │   │   └── ServiceResolver.ts  # 4-strategy service match
│   │   │   ├── contracts/
│   │   │   │   ├── tool-result.ts      # ToolResult<T> unificado
│   │   │   │   └── tool-schemas.ts     # Zod schemas (fuente única)
│   │   │   ├── security/
│   │   │   │   └── TenantEnforcer.ts   # Phantom type + DB verify
│   │   │   ├── utils/
│   │   │   │   └── timezone.ts         # localToUTC canónico
│   │   │   └── __tests__/              # Unit + adversarial tests
│   │   │
│   │   ├── adapters/             # ← CHANNEL BRIDGES
│   │   │   ├── dashboard/
│   │   │   │   └── DashboardBookingAdapter.ts
│   │   │   └── __tests__/
│   │   │       ├── DashboardBookingAdapter.test.ts
│   │   │       └── integration-flow.test.ts
│   │   │
│   │   ├── orchestrator/         # ← PIPELINE
│   │   │   ├── decision-engine.ts      # Fast-path vs LLM
│   │   │   ├── execution-engine.ts     # Tool execution
│   │   │   ├── LlmBridge.ts           # Groq API wrapper
│   │   │   ├── state-manager.ts        # ConversationState
│   │   │   └── tool-adapter/
│   │   │       └── RealToolExecutor.ts # → DashboardBookingAdapter
│   │   │
│   │   ├── agents/dashboard/     # Agent config + prompts
│   │   ├── providers/            # Deepgram, ElevenLabs, Groq
│   │   ├── circuit-breaker.ts    # Resiliencia LLM
│   │   └── fuzzy-match.ts        # Levenshtein puro (no deps)
│   │
│   ├── repositories/             # ← DATA LAYER
│   │   ├── SupabaseAppointmentRepository.ts
│   │   ├── SupabaseClientRepository.ts
│   │   ├── SupabaseServiceRepository.ts
│   │   ├── SupabaseFinanceRepository.ts
│   │   ├── SupabaseUserRepository.ts
│   │   ├── SupabaseBusinessRepository.ts
│   │   ├── SupabaseNotificationRepository.ts
│   │   ├── SupabaseReminderRepository.ts
│   │   └── __tests__/
│   │
│   ├── domain/
│   │   ├── use-cases/            # Business logic (channel-free)
│   │   ├── repositories/         # Interfaces (contratos)
│   │   └── errors/
│   │
│   └── cache.ts                  # Redis abstraction
│
├── supabase/
│   └── functions/
│       ├── process-whatsapp/     # WhatsApp AI agent (Deno)
│       ├── cron-reminders/       # Recordatorios automáticos
│       └── _shared/              # Helpers compartidos
│
├── __tests__/                    # Tests adicionales
│   ├── domain/
│   ├── unit/
│   ├── rate-limit/
│   └── edge-functions/
│
├── ARCHITECTURE.md               # Referencia técnica completa
├── AI_FLOWS.md                   # Flujos del sistema de IA
├── TESTING.md                    # Guía de testing
└── CHANGELOG.md
```

---

## Cómo Correr el Proyecto

### Requisitos

- Node.js 20+
- pnpm o npm
- Cuenta Supabase
- Cuenta Upstash Redis

### Instalación

```bash
git clone <repo>
cd cronix
npm install
cp .env.example .env.local
```

### Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# AI Providers
GROQ_API_KEY=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=

# Queue
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# Observabilidad (opcional)
NEXT_PUBLIC_AXIOM_DATASET=
AXIOM_TOKEN=
NEXT_PUBLIC_SENTRY_DSN=
```

### Desarrollo

```bash
npm run dev          # Servidor local con Turbopack
npm run typecheck    # TypeScript sin emit
npm run lint         # ESLint
```

---

## Cómo Correr Tests

```bash
npm test                    # Todos los tests
npm run test:watch          # Watch mode
npm run test:coverage       # Con cobertura

# Por categoría
npx vitest run lib/ai/core/__tests__/
npx vitest run lib/ai/adapters/__tests__/
npx vitest run lib/repositories/__tests__/

# E2E (requiere servidor corriendo)
npm run test:e2e
```

**Estado actual**: 82 test files, 1276 tests, 100% passing.

---

## Seguridad Multitenant

El sistema implementa **4 capas independientes** de aislamiento entre negocios:

### Capa 1: Phantom Type (TypeScript)

`TenantContext` solo puede construirse a través de `TenantEnforcer.verify()`. El compilador rechaza cualquier intento de construirlo directamente. No existe workaround en código de producción.

### Capa 2: TenantEnforcer (Runtime DB Check)

```typescript
const ctx = await TenantEnforcer.verify(requestedBusinessId, authUserId, timezone)
// ↑ Si el usuario no es dueño del businessId → throws UNAUTHORIZED
```

### Capa 3: Repositorios Filtrados

```typescript
// TODAS las queries incluyen:
.eq('business_id', ctx.businessId)

// updateStatus tiene assert explícito de ownership:
if (apt.business_id !== businessId) throw new Error('Ownership mismatch')
```

### Capa 4: Supabase RLS

Row Level Security en todas las tablas. Incluso si las capas superiores fallaran, la DB rechazaría accesos no autorizados.

---

## Manejo de IA — Determinismo vs LLM

### Fast-Paths (0 tokens LLM)

El sistema detecta intenciones claras y las ejecuta directamente:
- "sí" + estado `awaiting_confirmation` → ejecutar borrador
- "¿qué tengo hoy?" → `get_appointments_by_date`
- Booking completo con todos los datos → `confirm_booking` directo

### Fallback LLM (Groq Llama 3)

Cuando el input es ambiguo o faltan datos, el sistema delega al LLM con:
- Contexto del negocio (servicios, horarios)
- Historial de la conversación
- Tool definitions tipadas por Zod

### Resiliencia

- Circuit Breaker: 5 fallos → open (cooldown configurable)
- Never throws: `BookingEngine.dispatch()` siempre retorna `ToolResult`
- Cache degradation: Redis down → booking sigue funcionando

---

## Decisiones Técnicas Clave

### Por qué un solo BookingEngine

Antes, la lógica de booking estaba duplicada en 3 lugares:
- `RealToolExecutor.ts` (dashboard)
- `appointment.tools.ts` (legacy)
- `process-whatsapp/tool-executor.ts` (WhatsApp)

Un cambio en la validación de tiempo requería actualizarlo en 3 lugares. Ahora hay uno solo. Los tests lo cubren una vez. Los bugs se corrigen una vez.

### Por qué Phantom Types para TenantContext

Un `string` businessId podría olvidarse de verificar. Un `TenantContext` no puede existir sin verificación — es imposible tipográficamente, no solo por convención.

### Por qué Zod en vez de validación manual

Los schemas Zod son la fuente de verdad para:
1. Validación runtime de args del LLM
2. Definiciones de tools para la API del LLM

Si cambia el schema, ambos se actualizan automáticamente.

### Por qué fuzzy matching en ClientResolver

Los usuarios dictan nombres por voz. "Ana García" puede llegar como "Ana Garcia", "Ana Garzia", o "Ana". El threshold 0.45 tolera errores de transcripción sin introducir falsos positivos en negocios con pocos clientes.

---

## Documentación Adicional

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura completa, ADRs, pipelines
- [AI_FLOWS.md](./AI_FLOWS.md) — Flujos del sistema de IA, fast-paths, estado
- [TESTING.md](./TESTING.md) — Guía de testing, cobertura, escenarios críticos
- [CHANGELOG.md](./CHANGELOG.md) — Historial de cambios
