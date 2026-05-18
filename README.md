<div align="center">

# Cronix

**Plataforma SaaS de agendamiento inteligente para negocios de servicios — con WhatsApp + voz, pagos integrados y dashboard tiempo real**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-green?logo=supabase)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Vercel-Production-black?logo=vercel)](https://vercel.com)
[![PayPal](https://img.shields.io/badge/PayPal-Integrated-0070ba?logo=paypal)](./PAYPAL_INTEGRATION_GUIDE.md)
[![Tests](https://img.shields.io/badge/Tests-1338%20passed-green)](./TESTING.md)

</div>

---

## ¿Qué es Cronix?

Cronix es una plataforma SaaS para negocios de servicios (peluquerías, barberías, clínicas, estudios, spas) que combina:

- **Agendamiento inteligente por WhatsApp** — un agente de IA recibe reservas 24/7, entiende lenguaje natural, gestiona conflictos de horario y envía confirmaciones.
- **Dashboard web con asistente de voz** — el dueño gestiona agenda, clientes y finanzas desde el navegador, hablándole al sistema.
- **Pagos integrados (PayPal + cripto + manuales)** — los negocios pagan su suscripción Pro/Enterprise con tarjeta, PayPal o transferencia, y reciben confirmación instantánea con red de seguridad anti-fallos.
- **Sistema de referidos** — los negocios ganan meses gratis invitando a otros.
- **Aislamiento multi-tenant en 4 capas** — Phantom types + TenantEnforcer + repositorios filtrados + RLS de Postgres.

---

## Stack tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Framework | Next.js 15 (App Router) + React 19 + Turbopack | Frontend + API Routes + Server Actions |
| Lenguaje | TypeScript 5 (strict) | Tipado estricto, sin `any` en producción |
| UI | Tailwind CSS 3 · Framer Motion · lucide-react · shadcn-style components | Estilos + animaciones + iconografía |
| State | TanStack Query 5 · React Hook Form · Zod | Server-state, formularios, validación |
| i18n | next-intl 4 | 6 idiomas: es, en, fr, de, it, pt |
| DB | Supabase (PostgreSQL 15 + RLS) | Datos + autenticación + realtime |
| Cache & Sesión | Upstash Redis | Sesión conversacional + rate limit |
| Edge runtime | Supabase Edge Functions (Deno) | voice-worker, process-whatsapp, cron-reminders, push-notify, embed-text |
| Async queue | QStash (Upstash) | Webhooks NOWPayments + tareas diferidas |
| Auth | Supabase Auth + WebAuthn (Passkeys) | Multi-factor opcional |
| AI LLM | Groq `llama-3.3-70b-versatile` + `llama-3.1-8b-instant` fallback · Gemini `2.0-flash` opcional | Razonamiento + tool-calling |
| AI STT | Deepgram Nova-2 (`language=es`) | Voz → texto |
| AI TTS | Deepgram Aura-2 (`aura-2-nestor-es`) | Texto → voz |
| Pagos PayPal | `@paypal/react-paypal-js` + REST API + Webhooks | Tarjeta/PayPal — ver [PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md) |
| Pagos cripto | NOWPayments API + webhooks vía QStash | USDT (BSC) sin custodia |
| Pagos manuales | Pago Móvil (Venezuela) · Binance Pay | Verificación admin |
| PWA | `@ducanh2912/next-pwa` (custom service worker) | App instalable + offline |
| Push notifications | Web Push + VAPID | Notificaciones nativas browser/PWA |
| Observabilidad | Sentry · Axiom · Vercel Logs | Errores + métricas + logs estructurados |
| Testing | Vitest · React Testing Library · Playwright · MSW | Unit + integration + E2E |
| Quality gates | ESLint · Husky · lint-staged · pre-push hook | Pre-commit + pre-push automatizados |
| Deploy | Vercel (frontend + API) · Supabase (DB + edge) | Production |

---

## Arquitectura de alto nivel

```
                    ┌─────────────────────────────────────────────────┐
                    │                CHANNELS                         │
                    │                                                 │
   Owner (voz) ─────► voice-worker Edge Function (Deno)               │
                    │   capability registry + LLM fallback            │
                    │                                                 │
   Cliente (WA) ────► process-whatsapp Edge Function (Deno)           │
                    │   → BookingEngine (lib/ai/core)                 │
                    │                                                 │
   Cliente (web) ───► Next.js Dashboard (Server Components + RSC)     │
                    └─────────────────────┬───────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────┐
                    │   TenantEnforcer / business-router              │
                    │   (Supabase service role + RLS verification)    │
                    └─────────────────────┬───────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────┐
                    │              Repositories                       │
                    │   Supabase (PostgreSQL + RLS)                   │
                    │   + Upstash Redis (sesión + cache)              │
                    └─────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────────────┐
                    │              PAYMENTS                           │
                    │                                                 │
   PayPal popup ────► /api/webhooks/paypal (async safety net)         │
                    │   → fn_finalize_paypal_payment (RPC atómica)    │
                    │                                                 │
   NOWPayments ─────► /api/webhooks/nowpayments → QStash → /api/queue │
                    │                                                 │
   Manual review ───► /dashboard/admin/payments (platform_admin only) │
                    └─────────────────────────────────────────────────┘
```

**Principios clave:**

- **Cada canal owna su agente, pero comparten contratos** (`ToolResult`, schemas Zod en WhatsApp, `ICapability` en voz).
- **La lógica de negocio nunca se duplica** entre lecturas y escrituras del mismo canal.
- **Los pagos tienen doble vía de fulfillment** (frontend + webhook async) con idempotencia garantizada en Postgres.

---

## Módulos Core

### 🤖 Agente WhatsApp (`process-whatsapp`)

Recibe webhook de Meta → verifica HMAC → enruta al business correcto → ejecuta `BookingEngine` (Zod + UseCases + RLS) → responde por API de WhatsApp Cloud.

- Documentación: [`docs/WHATSAPP_AI_ARCHITECTURE.md`](./docs/WHATSAPP_AI_ARCHITECTURE.md)
- Código: `supabase/functions/process-whatsapp/`, `lib/ai/core/`
- Tests: `__tests__/ai/`, `lib/ai/core/__tests__/`

### 🎙️ Asistente de voz dashboard (`voice-worker`)

Edge Function Deno con capability registry, fast-paths anafóricos ("reagéndala", "cancélala") y fallback LLM. STT/TTS via Deepgram.

- Documentación: [`AI_FLOWS.md`](./AI_FLOWS.md)
- Código: `supabase/functions/voice-worker/`
- Tests: `supabase/functions/voice-worker/**/__tests__/`

### 💳 Sistema de pagos

Tres pasarelas convergiendo a una misma tabla `saas_invoices` con estados unificados (`waiting → confirming → finished | failed | expired`).

| Pasarela | Webhook | Idempotencia | Doc |
|---|---|---|---|
| **PayPal** | `/api/webhooks/paypal` (firma verificada) | RPC `fn_finalize_paypal_payment` con `FOR UPDATE` | **[PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md)** |
| **NOWPayments** (cripto) | `/api/webhooks/nowpayments` → QStash → `/api/queue/process-saas-payment` | Status-based `toInvoiceStatus()` | `app/api/queue/process-saas-payment/route.ts` |
| **Pago Móvil / Binance** | No aplica (manual) | Verificación admin en `/dashboard/admin/payments` | `app/[locale]/dashboard/admin/payments/` |

- Helper compartido: `lib/payments/subscription-fulfillment.ts` (lógica aditiva de fechas, applyReferralBonus).
- Documentación general: [`docs/architecture/PAYMENTS_AND_PLANS.md`](./docs/architecture/PAYMENTS_AND_PLANS.md)
- **Documentación PayPal completa: [`PAYPAL_INTEGRATION_GUIDE.md`](./PAYPAL_INTEGRATION_GUIDE.md)** — arquitectura, config, suite de pruebas y runbook.

### 🎁 Programa de referidos

Cada business genera un código único. Cuando un referido completa su primer pago, el referidor recibe 30 días gratis automáticamente (`applyReferralBonus`).

- Código: `lib/referrals/rewards.ts`, `app/[locale]/dashboard/plans/`
- Tests: `__tests__/components/referral-client.test.tsx`

### 🔔 Notificaciones in-app

Tabla `notifications` con CHECK constraint en `type IN ('info','success','warning','error')`. Bell con badge realtime via Supabase subscriptions.

- Hook: `lib/hooks/use-in-app-notifications.ts`
- Tabla: migración `20260403233000_in_app_notifications.sql`

### 🛡️ Seguridad multi-tenant

Cuatro capas independientes — ver sección [Seguridad](#seguridad-multi-tenant) abajo.

---

## Estructura del proyecto

```
cronix/
├── app/
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── paypal/route.ts          # ← Webhook PayPal con firma verificada
│   │   │   └── nowpayments/route.ts     # ← Webhook cripto
│   │   ├── queue/process-saas-payment/  # ← Worker QStash (cripto)
│   │   ├── cron/check-subscriptions/    # ← Vencimientos
│   │   ├── assistant/                   # ← Voice-worker proxy
│   │   ├── passkey/                     # ← WebAuthn
│   │   ├── admin/                       # ← Endpoints admin
│   │   └── health/
│   ├── auth/callback/                   # ← OAuth + email confirmation
│   └── [locale]/
│       ├── invite/[code]/               # ← Landing pública referidos
│       ├── register/                    # ← Captura ?ref=
│       ├── login/
│       └── dashboard/
│           ├── plans/                   # ← Plan actual + referidos
│           ├── settings/
│           │   ├── payment-method-modal.tsx  # ← UI botones PayPal
│           │   └── actions.ts                # ← Server actions PayPal/cripto
│           ├── admin/payments/          # ← Approve/reject manual payments
│           ├── appointments/
│           ├── clients/
│           ├── finances/
│           └── profile/
│
├── lib/
│   ├── payments/
│   │   ├── paypal.ts                       # ← SDK adapter + verifyWebhookSignature
│   │   ├── subscription-fulfillment.ts     # ← Helper compartido (paypal + cripto)
│   │   ├── nowpayments.ts                  # ← Cripto SDK
│   │   └── bcv-rate.ts                     # ← Tasa BCV para Pago Móvil
│   │
│   ├── ai/
│   │   ├── core/                        # ← Núcleo compartido (WhatsApp)
│   │   │   ├── booking/BookingEngine.ts
│   │   │   ├── contracts/{tool-result, tool-schemas}.ts
│   │   │   ├── security/TenantEnforcer.ts
│   │   │   └── utils/timezone.ts
│   │   ├── tools/                       # ← Tool definitions WhatsApp
│   │   └── providers/                   # ← Groq, Deepgram
│   │
│   ├── repositories/                    # ← Data layer (DIP)
│   ├── domain/
│   │   ├── use-cases/                   # ← Business logic (channel-free)
│   │   ├── repositories/                # ← Interfaces (contratos)
│   │   └── errors/
│   ├── referrals/rewards.ts
│   ├── plans/plan-limits.ts
│   └── supabase/                        # ← Clients (server, client, middleware, admin)
│
├── supabase/
│   ├── functions/
│   │   ├── voice-worker/                # ← Asistente voz dashboard (Deno)
│   │   ├── process-whatsapp/            # ← Agente WhatsApp (Deno)
│   │   ├── whatsapp-webhook/            # ← Meta webhook
│   │   ├── whatsapp-service/            # ← Outbound
│   │   ├── cron-reminders/
│   │   ├── push-notify/
│   │   └── embed-text/
│   └── migrations/
│       ├── 20260516130000_paypal_finalize_rpc.sql  # ← RPC atómica PayPal
│       ├── 20260504100000_referral_system.sql
│       ├── 20260430120000_saas_invoices.sql
│       └── ... (60+ migraciones versionadas)
│
├── tests/
│   ├── e2e/                             # ← Playwright (smoke, payment-flow, voice)
│   └── integration/                     # ← Vitest integration (repos contra DB real)
│
├── __tests__/                           # ← Vitest unit tests (1338 tests)
│   ├── domain/use-cases/
│   ├── components/
│   ├── ai/
│   ├── validations/
│   └── unit/
│
├── messages/                            # ← i18n (es, en, fr, de, it, pt)
├── docs/
│   ├── architecture/
│   │   ├── PAYMENTS_AND_PLANS.md
│   │   ├── AI_MASTER_GUIDE.md
│   │   ├── FRONTEND_ARCHITECTURE_AND_STATE.md
│   │   └── ANTI_HALLUCINATION_PATTERNS.md
│   ├── operations/
│   └── security/
│
├── PAYPAL_INTEGRATION_GUIDE.md          # ← Manual completo de PayPal
├── ARCHITECTURE.md                      # ← Referencia técnica completa
├── AI_FLOWS.md                          # ← Flujos del sistema de IA
├── TESTING.md                           # ← Guía de testing
├── CHANGELOG.md
└── README.md                            # ← Este archivo
```

---

## Instalación y levantamiento local

### Requisitos

- **Node.js 20+** (LTS recomendado)
- **npm** (o pnpm/yarn compatible)
- **Docker Desktop** — necesario para Supabase local (`npx supabase start`)
- **Cuenta Supabase** (para enlazar el proyecto remoto)
- **Cuenta Upstash Redis** (sesión conversacional, rate limit)
- **Cuenta Groq** (LLM principal) — opcional Gemini como fallback
- **Cuenta Deepgram** (STT + TTS para voz)
- **Cuenta PayPal Developer** (Sandbox al menos) — ver [PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md)

### Pasos

```bash
git clone https://github.com/ROMEROLUIS15/cronix.git
cd cronix
npm install
cp .env.local.example .env.local
# Edita .env.local con tus credenciales (ver sección Variables de entorno)
```

### Stack local

```bash
# 1. Levantar Supabase local (Docker debe estar corriendo)
npx supabase start

# 2. Aplicar migraciones (opcional, se aplican automáticamente en start)
npx supabase db reset

# 3. Regenerar tipos TypeScript desde el schema local
npx supabase gen types typescript --local > types/database.types.ts

# 4. Iniciar dev server (Next.js + Turbopack)
npm run dev
```

Abre `http://localhost:3000`. Supabase Studio queda en `http://127.0.0.1:54323`.

### Scripts disponibles

```bash
npm run dev               # Dev server con Turbopack
npm run build             # Build producción
npm run start             # Servidor producción
npm run lint              # ESLint
npm run typecheck         # TypeScript --noEmit
npm test                  # Vitest unit tests
npm run test:watch        # Vitest watch mode
npm run test:integration  # Tests integración (contra Supabase local)
npm run test:e2e          # Playwright E2E (requiere dev server)
npm run test:e2e:smoke    # Solo tests smoke
npm run test:coverage     # Coverage report
npm run e2e:setup         # Sembrar datos E2E
```

### Gates de calidad automatizados

- **Pre-commit (Husky + lint-staged):** ESLint `--fix` sobre archivos staged.
- **Pre-push:** ESLint completo + `tsc --noEmit` + `vitest run`. Si alguno falla, el push se cancela. **No usar `--no-verify`.**

---

## Variables de entorno

`.env.local.example` documenta todas. Resumen por área:

### Supabase

```bash
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
DB_PASSWORD="TU_DB_PASSWORD"
```

### Auth (Google OAuth)

```bash
ID_CLIENTE_GOOGLE=TU_GOOGLE_CLIENT_ID
SECRETO_CLIENTE_GOOGLE=TU_GOOGLE_CLIENT_SECRET
```

### WhatsApp Cloud API (Meta)

```bash
WHATSAPP_ACCESS_TOKEN=TU_META_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID=TU_BUSINESS_ACCOUNT_ID
WHATSAPP_APP_SECRET=TU_APP_SECRET
WHATSAPP_VERIFY_TOKEN=TU_VERIFY_TOKEN
```

### AI

```bash
LLM_API_KEY=TU_GROQ_API_KEY              # comma-separated → key rotation
CEREBRAS_API_KEY=TU_CEREBRAS_KEY         # opcional
DEEPGRAM_AURA_API_KEY=TU_DEEPGRAM_KEY    # STT (Nova-2) + TTS (Aura-2)
# GEMINI_API_KEY=TU_GEMINI_KEY           # opcional fallback
```

### Redis & QStash (Upstash)

```bash
UPSTASH_REDIS_REST_URL=https://TU-UPSTASH.upstash.io
UPSTASH_REDIS_REST_TOKEN=TU_REDIS_TOKEN
QSTASH_TOKEN=TU_QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY=TU_CURRENT_KEY
QSTASH_NEXT_SIGNING_KEY=TU_NEXT_KEY
QSTASH_URL=https://qstash.upstash.io
```

### Pagos

```bash
# PayPal — ver PAYPAL_INTEGRATION_GUIDE.md
NEXT_PUBLIC_PAYPAL_CLIENT_ID=TU_CLIENT_ID
PAYPAL_CLIENT_SECRET=TU_CLIENT_SECRET
PAYPAL_WEBHOOK_ID=TU_WEBHOOK_ID
# PAYPAL_ENV=live                        # ← opt-in explícito, default Sandbox

# NOWPayments (cripto)
NOWPAYMENTS_API_KEY=TU_NP_API_KEY
NOWPAYMENTS_IPN_SECRET=TU_NP_IPN_SECRET
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
```

### Push notifications (VAPID)

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=TU_VAPID_PUBLIC
VAPID_PRIVATE_KEY=TU_VAPID_PRIVATE
VAPID_SUBJECT=mailto:soporte@TU_DOMINIO
CRON_SECRET=TU_CRON_SECRET
```

### Observabilidad

```bash
NEXT_PUBLIC_SENTRY_DSN=TU_SENTRY_DSN
SENTRY_DSN=TU_SENTRY_DSN
SENTRY_AUTH_TOKEN=TU_SENTRY_TOKEN
SENTRY_ORG=TU_ORG
SENTRY_PROJECT=TU_PROYECTO
HELICONE_API_KEY=TU_HELICONE_KEY        # opcional
NEXT_PUBLIC_AXIOM_DATASET=TU_DATASET
AXIOM_TOKEN=TU_AXIOM_TOKEN
```

### Site config

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
APP_URL=http://localhost:3000
```

### E2E testing

```bash
E2E_TEST_EMAIL=TU_TEST_EMAIL
E2E_TEST_PASSWORD=TU_TEST_PASSWORD
```

> **Importante:** `.env.local` está en `.gitignore`. **NUNCA commitees credenciales reales.** Para diferencias entre Sandbox/Live de PayPal, consulta el detalle en [PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md).

---

## Tests

```bash
npm test                          # 82 archivos · 1338 tests · ~38s
npm run test:integration          # 2 archivos · 13 tests · contra Supabase local
npm run test:e2e                  # Playwright (requiere dev server)
npm run test:e2e:smoke            # Suite reducida
```

**Estado actual:** 1338 tests unitarios + 13 integration + suite E2E. 100% passing en `main`.

Detalle de estrategia, cobertura y escenarios críticos: [TESTING.md](./TESTING.md).

---

## Seguridad multi-tenant

El sistema implementa **4 capas independientes** de aislamiento entre negocios. Falla en una capa NO compromete las otras.

### Capa 1 — Phantom Type (TypeScript compile-time)

`TenantContext` solo puede construirse mediante `TenantEnforcer.verify()`. El compilador rechaza cualquier intento de construirlo directamente. No existe workaround en código de producción.

### Capa 2 — TenantEnforcer (Runtime DB check)

```ts
const ctx = await TenantEnforcer.verify(requestedBusinessId, authUserId, timezone)
// Si el usuario no es dueño del businessId → throws UNAUTHORIZED
```

### Capa 3 — Repositorios filtrados

```ts
// TODAS las queries incluyen:
.eq('business_id', ctx.businessId)

// updateStatus tiene assert explícito de ownership:
if (apt.business_id !== businessId) throw new Error('Ownership mismatch')
```

### Capa 4 — Supabase Row Level Security

RLS en todas las tablas (`businesses`, `clients`, `appointments`, `saas_invoices`, `notifications`, etc). Aun si las capas superiores fallaran, la DB rechazaría accesos no autorizados.

---

## Patrones anti-alucinación (IA)

Detalle completo en [docs/architecture/ANTI_HALLUCINATION_PATTERNS.md](./docs/architecture/ANTI_HALLUCINATION_PATTERNS.md). Resumen:

1. **Input Bypass / Fast Paths** — intenciones claras ("¿qué tengo mañana?") se ejecutan sin pasar por el LLM. 0 tokens.
2. **Response Bypass** — flag `bypassLLM` en `ICapability`. El agente entrega la prosa de la tool tal cual, sin re-síntesis del LLM.
3. **Transactional RAG (Direct Grounding)** — el system prompt inyecta catálogo, horarios y citas del día en vivo desde la DB.
4. **Context Audit (Corpus + Frame Cutoff)** — el corpus se corta en el último "frame boundary" para que tokens viejos no contaminen los guards.
5. **Date Guards + Negative Constraints** — `detectTemporalIntent()` sobreescribe parámetros del LLM cuando el usuario dijo "hoy/mañana/pasado mañana".

Más una capa de **per-turn dedup** mediante fingerprint `(tool + args canónicos)` que evita dobles bookings si el modelo entra en bucle.

---

## Decisiones técnicas clave

### Por qué doble vía de fulfillment (frontend + webhook) en PayPal

Si el usuario cierra la pestaña a mitad de pago, el frontend nunca confirma con el servidor pero PayPal ya cobró. El webhook async garantiza que el plan se active aun en ese caso. **Idempotencia garantizada en Postgres** vía `FOR UPDATE` lock. Detalle en [PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md#2-por-qué-webhook-async--frontend-dual-path).

### Por qué `PAYPAL_ENV=live` es opt-in explícito

Vercel pone `NODE_ENV=production` en todos los deploys (incluyendo previews). Si usáramos `NODE_ENV` como señal de "Live", cualquier PR cobraría dinero real al desplegar su preview. Hacer Live opt-in explícito previene cobros accidentales.

### Por qué capabilities en lugar de un god-file

El antiguo `tools.ts` concentraba detección de fast-path, schema LLM y acceso a DB. Cada cambio tocaba el archivo entero. Ahora cada intent vive en `capabilities/<intent>/` con `fast-path.ts`, `tool.ts` y `index.ts` que exponen una `ICapability`. Añadir un intent = import + línea en el array.

### Por qué `BookingEngine` sigue vivo (solo WhatsApp)

WhatsApp es transaccional puro: webhook → tool call → respuesta. Usa `BookingEngine` (Zod + UseCases + RLS) como single source of truth. El canal de voz, en cambio, es conversacional con fast-paths anafóricos pesados ("reagéndala") y migró a capability-based.

### Por qué Phantom Types para `TenantContext`

Un `string` businessId podría olvidarse de verificar. Un `TenantContext` no puede existir sin verificación — es imposible tipográficamente, no solo por convención.

### Por qué Zod como fuente única

Los schemas Zod son fuente de verdad para:
1. Validación runtime de args del LLM.
2. Definiciones de tools para la API del LLM.

Si cambia el schema, ambos se actualizan automáticamente.

---

## Documentación adicional

### Módulos
- **[PAYPAL_INTEGRATION_GUIDE.md](./PAYPAL_INTEGRATION_GUIDE.md)** — Manual completo de la pasarela PayPal (arquitectura, config, suite de pruebas, runbook).
- [docs/architecture/PAYMENTS_AND_PLANS.md](./docs/architecture/PAYMENTS_AND_PLANS.md) — Sistema de pagos y planes (general).
- [docs/WHATSAPP_AI_ARCHITECTURE.md](./docs/WHATSAPP_AI_ARCHITECTURE.md) — Agente WhatsApp end-to-end.
- [AI_FLOWS.md](./AI_FLOWS.md) — Flujos del sistema de IA, fast-paths, estado.

### Referencia técnica
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Arquitectura completa, ADRs, pipelines.
- [docs/architecture/ANTI_HALLUCINATION_PATTERNS.md](./docs/architecture/ANTI_HALLUCINATION_PATTERNS.md) — Los 5 pilares anti-alucinación.
- [docs/architecture/AI_MASTER_GUIDE.md](./docs/architecture/AI_MASTER_GUIDE.md) — Guía maestra del sistema de IA.
- [docs/architecture/FRONTEND_ARCHITECTURE_AND_STATE.md](./docs/architecture/FRONTEND_ARCHITECTURE_AND_STATE.md) — Frontend y manejo de estado.
- [docs/security/SECURITY_AND_RATE_LIMITS.md](./docs/security/SECURITY_AND_RATE_LIMITS.md) — Seguridad y rate limits.

### Calidad
- [TESTING.md](./TESTING.md) — Guía de testing, cobertura, escenarios críticos.
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) — Guía operativa de tests.
- [CHANGELOG.md](./CHANGELOG.md) — Historial de cambios.

### Operación
- [docs/operations/CI_CD_GATEKEEPER.md](./docs/operations/CI_CD_GATEKEEPER.md) — Gates pre-commit/pre-push.
- [SECURITY_FINAL_REPORT.md](./SECURITY_FINAL_REPORT.md) — Reporte final de seguridad.

---

## Licencia

Proyecto privado. Todos los derechos reservados.
