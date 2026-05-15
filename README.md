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
                    ┌────────────────────────────────────────────┐
                    │                CHANNELS                    │
                    │                                            │
   Owner (voz) ─────► voice-worker Edge Function (Deno)          │
                    │   capability registry + LLM fallback       │
                    │                                            │
   Cliente (WA) ────► process-whatsapp Edge Function (Deno)      │
                    │   → BookingEngine (lib/ai/core)            │
                    └─────────────────────┬──────────────────────┘
                                          │
                                          ▼
                    ┌────────────────────────────────────────────┐
                    │   TenantEnforcer / business-router         │
                    │   (Supabase service role + RLS)            │
                    └─────────────────────┬──────────────────────┘
                                          │
                                          ▼
                    ┌────────────────────────────────────────────┐
                    │              Repositories                  │
                    │   Supabase (PostgreSQL + RLS)              │
                    │   + Upstash Redis (sesión + cache)         │
                    └────────────────────────────────────────────┘
```

**Principio clave**: cada canal owna su agente, pero ambos comparten contratos (`ToolResult`, schemas Zod en WhatsApp, `ICapability` en voz). La lógica de negocio nunca se duplica entre lecturas y escrituras de un mismo canal.

---

## Flujo de Ejecución (Voz del Dashboard — End-to-End)

```
1. Input del usuario (voz multipart o texto JSON)  →  POST /functions/v1/voice-worker
2. JWT verify + rate limit (Upstash, 30/min)
3. STT: Groq Whisper (sólo si llega audio)
4. Carga paralela:  business context  +  sesión Redis (history + lastRef)
5. agent.ts:
   ├── FAST PATH         registry.detectFastPath() → ejecuta capability sin LLM
   └── LLM PATH          provider.chat() → tool_calls
                         ├── Date guard (override "hoy" / "mañana" / "pasado mañana")
                         ├── Dedup fingerprint (tool + args canónicos)
                         ├── Capability.execute(ctx, args)
                         └── Bypass-LLM: si la tool produce prosa, se devuelve tal cual
6. saveSession() + dispatchBellNotification() en paralelo
7. TTS: Deepgram → data:audio/mp3;base64
8. Respuesta JSON { text, audioUrl, actionPerformed, transcription, modelUsed }
```

---

## Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Frontend | Next.js 15 + React 19 | Dashboard web |
| API | Next.js API Routes | Endpoints REST |
| AI LLM | Groq (Llama 3.3 70B) + Gemini fallback | Razonamiento + tool calls |
| AI STT | Groq Whisper (voice-worker) · Deepgram (WhatsApp) | Voz → texto |
| AI TTS | Deepgram (voice-worker) · ElevenLabs (legacy) | Texto → voz |
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
│   ├── auth/callback/            # OAuth + email confirmation handler
│   └── [locale]/                 # Páginas del dashboard (i18n)
│       ├── invite/[code]/        # Landing pública de invitación referidos
│       ├── register/             # Registro — captura ?ref= y pasa referred_by_id
│       ├── login/
│       ├── forgot-password/
│       └── dashboard/
│           ├── plans/            # Plan actual + programa de referidos (unificado)
│           ├── referrals/        # Redirect → /dashboard/plans
│           ├── appointments/
│           ├── clients/
│           ├── finances/
│           ├── settings/
│           └── profile/
│
├── lib/
│   ├── ai/
│   │   ├── core/                 # ← NÚCLEO compartido (WhatsApp)
│   │   │   ├── booking/
│   │   │   │   ├── BookingEngine.ts    # Único source of truth para WA
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
│   │   ├── tools/                # Tool definitions consumidas por WA
│   │   ├── providers/            # Deepgram, ElevenLabs, Groq
│   │   ├── circuit-breaker.ts    # Resiliencia LLM
│   │   ├── fuzzy-match.ts        # Levenshtein puro (no deps)
│   │   └── with-tenant-guard.ts
│   │
│   ├── repositories/             # ← DATA LAYER
│   │   ├── SupabaseAppointmentRepository.ts
│   │   ├── SupabaseClientRepository.ts
│   │   ├── SupabaseServiceRepository.ts
│   │   ├── SupabaseFinanceRepository.ts
│   │   ├── SupabaseUserRepository.ts
│   │   ├── SupabaseBusinessRepository.ts  # +getByReferralCode()
│   │   ├── SupabaseNotificationRepository.ts
│   │   ├── SupabaseReminderRepository.ts
│   │   └── __tests__/
│   │
│   ├── domain/
│   │   ├── use-cases/            # Business logic (channel-free)
│   │   ├── repositories/         # Interfaces (contratos)
│   │   │   └── IBusinessRepository.ts  # +getByReferralCode(), +referred_by_id en create()
│   │   └── errors/
│   │
│   ├── referrals/
│   │   └── rewards.ts            # getReferralRewardInfo() — lógica pura
│   │
│   └── cache.ts                  # Redis abstraction
│
├── supabase/
│   └── functions/
│       ├── voice-worker/                 # ← Asistente de voz del dashboard (Deno)
│       │   ├── index.ts                  # HTTP handler + corpus + sesión
│       │   ├── agent.ts                  # Loop fast-path → LLM → bypass synthesis
│       │   ├── prompt.ts                 # System prompt + constraints negativos
│       │   ├── stt.ts / tts.ts           # Groq Whisper · Deepgram TTS
│       │   ├── redis.ts                  # Rate-limit + sesión Upstash
│       │   ├── notifications.ts          # Bell notifications (post-write)
│       │   ├── core/
│       │   │   ├── session.ts            # Cascade Redis → client-history → []
│       │   │   ├── tool-context.ts       # ToolContext compartido por capabilities
│       │   │   ├── fuzzy.ts              # Match difuso (clientes/servicios)
│       │   │   ├── time-format.ts        # Hora local en español
│       │   │   ├── time-parser.ts        # Parser determinista de horas
│       │   │   ├── date-parser.ts        # Parser determinista de fechas ES
│       │   │   ├── repos/                # Acceso a appointments/clients/services
│       │   │   └── __tests__/            # Fuzzy + time + date specs
│       │   ├── providers/                # ILLMProvider · Groq · Gemini · registry
│       │   └── capabilities/             # ← UN intent por carpeta
│       │       ├── _shared/
│       │       │   ├── Capability.ts     # Contrato ICapability + FastPathInput
│       │       │   ├── registry.ts       # detectFastPath + executeByName
│       │       │   └── __tests__/
│       │       ├── schedule/             # smart_schedule (write)
│       │       ├── reschedule/           # reschedule_booking (write, anafórico)
│       │       ├── cancel/               # cancel_booking (write, anafórico)
│       │       ├── list-appointments/    # get_appointments_by_date (read)
│       │       ├── available-slots/     # get_available_slots (read)
│       │       ├── search-clients/       # search_clients (read)
│       │       ├── last-visit/           # get_last_visit (read)
│       │       ├── get-services/         # list_services (read)
│       │       ├── create-client/        # create_client (write)
│       │       └── delete-client/        # delete_client (write con consent)
│       │
│       ├── process-whatsapp/             # WhatsApp AI agent (Deno + BookingEngine)
│       ├── whatsapp-webhook/             # Webhook Meta + HMAC
│       ├── whatsapp-service/             # Outbound send
│       ├── cron-reminders/               # Recordatorios automáticos
│       ├── push-notify/                  # Web Push fan-out
│       ├── embed-text/                   # Embeddings auxiliares
│       └── _shared/                      # booking-adapter, helpers
│
├── __tests__/
│   ├── components/
│   │   └── referral-client.test.tsx   # 32 tests — link /invite/[code]
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

## Manejo de IA — 5 Capas Anti-Alucinación

Detalle completo en [docs/architecture/ANTI_HALLUCINATION_PATTERNS.md](./docs/architecture/ANTI_HALLUCINATION_PATTERNS.md). En código real:

1. **Input Bypass / Fast Paths** — `capabilities/_shared/registry.ts → detectFastPath()` enruta intenciones claras (ej: "¿qué tengo mañana?", "reagéndala a las 5") al ejecutor sin pasar por el LLM. 0 tokens, latencia <500 ms.
2. **Response Bypass / Template-Based Response** — flag `bypassLLM` en `ICapability`. `agent.ts` salta la segunda pasada del LLM y entrega la prosa de la tool tal cual (`BYPASS_CAPABILITIES`). Elimina el riesgo de que Llama reescriba el resultado.
3. **Transactional RAG (Direct Grounding)** — `index.ts → loadBusinessContext()` inyecta catálogo de servicios, horarios y citas del día activas en el system prompt. Sin embeddings, sin `ai_memories`: la "memoria RAM" es la DB en vivo.
4. **Context Audit (Corpus + Frame Cutoff)** — `index.ts` corta el corpus en el último "frame boundary" (asistente cerrando intent) y solo carga citas con `.gte/.lte` del día. Evita que tokens de turnos pasados contaminen los guards.
5. **Date Guards + Negative Constraints** — `detectTemporalIntent()` en `agent.ts` sobre-escribe `date` cuando el usuario dijo "hoy" / "mañana" / "pasado mañana", y `prompt.ts` aplica directivas tipo "si no llamaste a la tool, NO SABES". Última línea de defensa frente a alucinación de parámetros.

Capa extra (no contada como pilar): **per-turn dedup** mediante fingerprint `(tool + args canónicos)` para evitar dobles bookings si el modelo entra en bucle.

### Fallback LLM (Groq Llama 3.3 70B · Gemini fallback)

Cuando el input es ambiguo o faltan datos, el agente delega al provider (`providers/registry.ts`) con:
- Contexto del negocio (servicios activos, horarios, citas del día)
- Historial saneado (Redis → client-history → vacío)
- Definiciones de tools desde `getToolDefinitions()` (cada capability las expone)

### Resiliencia

- Provider failover: `LLM_PROVIDER=gemini,groq` → Gemini primario, Groq backup
- Rate limit Upstash: 30 req/min/usuario
- Sesión degradable: si Redis cae, la conversación sigue con el `history` del cliente
- `executeByName()` nunca lanza — todo error se serializa como `ToolResult`

---

## Decisiones Técnicas Clave

### Por qué capabilities en lugar de un god-file

El antiguo `tools.ts` concentraba detección de fast-path, schema LLM y acceso a DB para todos los intents. Cada cambio tocaba el archivo y los regexes se pisaban entre sí.

Ahora cada intent vive en una carpeta `capabilities/<intent>/` con tres piezas: `fast-path.ts`, `tool.ts` (ejecución) y `index.ts` que expone una `ICapability`. El registry decide orden y prioridad — añadir un intent es un import + una línea en el array.

### Por qué BookingEngine sigue vivo (sólo en WhatsApp)

El canal WhatsApp es transaccional puro: webhook → tool call → respuesta. Sigue usando `BookingEngine` (Zod + UseCases + RLS) como single source of truth. El canal de voz, en cambio, es conversacional y depende fuertemente de fast-paths anafóricos ("reagéndala", "cancélala"), por lo que se trasladó a la arquitectura capability-based dentro de la Edge Function.

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

- [docs/architecture/ANTI_HALLUCINATION_PATTERNS.md](./docs/architecture/ANTI_HALLUCINATION_PATTERNS.md) — Los 5 pilares arquitectónicos para evitar alucinaciones en los Agentes de IA
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura completa, ADRs, pipelines
- [AI_FLOWS.md](./AI_FLOWS.md) — Flujos del sistema de IA, fast-paths, estado
- [TESTING.md](./TESTING.md) — Guía de testing, cobertura, escenarios críticos
- [CHANGELOG.md](./CHANGELOG.md) — Historial de cambios
