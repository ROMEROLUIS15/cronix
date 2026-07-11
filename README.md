<div align="center">

# Cronix

**SaaS multi-tenant de agendamiento conversacional para negocios de servicios. Agente WhatsApp 24/7, asistente de voz en el dashboard, pagos integrados (PayPal + cripto + manual), todo sobre un stack de IA a costo operativo cercano a $0.**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%2015%20%2B%20pgvector-green?logo=supabase)](https://supabase.com)
[![Deno](https://img.shields.io/badge/Edge-Deno-000?logo=deno)](https://deno.land)

</div>

---

## TL;DR técnico

- **Doble runtime físico**: Node.js (Next.js 15 App Router en Vercel) + Deno (Edge Functions en Supabase). Cero cross-imports — la lógica compartida se duplica byte-by-byte bajo `supabase/functions/_shared/` con tests de parity que fallan al menor drift.
- **Aislamiento multi-tenant**: repositorios filtrados (`.eq('business_id', …)` + ownership asserts) → Row Level Security en Postgres (`current_business_id()` del JWT) → `ConstitutionalReviewer` semántico sobre los writes de IA (WhatsApp/voz). El UI del dashboard se aísla por RLS; los canales de IA añaden el reviewer.
- **10 mecanismos anti-alucinación verificables** en el código: corpus mention guards, fast-paths sin LLM, date-guard determinista, frame-cutoff del corpus, per-turn fingerprint dedup, response bypass, confirmation gate 2-turn, embedded `<function>` recovery, router semántico, constitutional reviewer.
- **Pipeline de IA cero-costo**: Groq (GPT-OSS 120B + 20B con key rotation), Gemini 2.0-flash opcional vía endpoint OpenAI-compat, embeddings `gte-small` (384 dim) ejecutándose dentro del Edge runtime de Supabase, Deepgram Nova-2 (STT) y Aura-2 (TTS) en free tier. Stack productivo a $0/mes.
- **Memoria episódica vectorial** (`ai_memories_v2`, pgvector) con recall obligatorio antes de cada escritura supervisada.
- **Observabilidad estructurada** (`ai_traces`) + **pipeline diario de training-data** (`ai_training_exports`, cron 03:00 UTC, cero PII, JSONL versionado por `schema_version`).
- **Pagos idempotentes**: PayPal con RPC `fn_finalize_paypal_payment` (FOR UPDATE) + webhook async como red de seguridad; NOWPayments cripto vía QStash queue con back-pressure; manuales con aprobación admin.

---

## ¿Qué resuelve?

Negocios de servicios (peluquerías, barberías, clínicas, spas, estudios) pierden citas y tiempo porque:

1. **Atender mensajes manualmente** mata productividad.
2. **Las apps tradicionales** obligan al cliente a descargar algo o registrarse.
3. **Los chatbots existentes alucinan** — agendan en huecos ocupados, confunden clientes con nombres similares, repiten operaciones, ignoran zona horaria.
4. **Aislamiento de datos** entre negocios en SaaS multi-tenant suele ser una sola línea `WHERE business_id =` que un junior puede olvidar.
5. **Pagos en LATAM**: tarjeta no siempre llega, cripto requiere educación, transferencia manual requiere humano.

Cronix ataca los 5 simultáneamente.

---

## Stack tecnológico real (verificado contra `package.json` + código)

| Capa | Tecnología | Propósito |
|---|---|---|
| Framework | Next.js 15 + React 19 + Turbopack | App Router, RSC, Server Actions, API Routes |
| Lenguaje | TypeScript 5 (`noUncheckedIndexedAccess`) | Type-first, sin `any` en código de producción |
| UI | Tailwind 3 · Framer Motion · lucide-react · `shadcn`-style | Estilos + motion + iconos |
| Estado | TanStack Query 5 · React Hook Form · Zod 3 | Server-state, forms, validación runtime |
| i18n | next-intl 4 (es/en/fr/de/it/pt) | 6 idiomas |
| DB | Supabase (PostgreSQL 15 + RLS + pgvector) | Datos + auth + realtime |
| Cache/sesión | Upstash Redis | Sesión conversacional + rate-limits |
| Edge runtime | Supabase Edge Functions (Deno) | voice-worker, process-whatsapp, whatsapp-webhook, whatsapp-service, cron-reminders, push-notify, embed-text, export-ai-traces |
| Queue | QStash (Upstash) | Webhooks NOWPayments + reintentos LLM rate-limit |
| Auth | Supabase Auth + WebAuthn (Passkeys) | `@simplewebauthn/server` + `/browser` |
| LLM principal | Groq `openai/gpt-oss-120b` | Razonamiento + tool-calling |
| LLM fallback | Groq `openai/gpt-oss-20b` | Decisor ReAct + reviewer + fallback |
| LLM alterno | Gemini `gemini-2.0-flash` (OpenAI-compat) | Activable por `LLM_PROVIDER` env |
| STT | Deepgram Nova-2 (`language=es`, keywords boost) | Voz → texto con sesgo a nombres reales |
| TTS | Deepgram Aura-2 (`aura-2-nestor-es`) | Texto → voz |
| Embeddings | `gte-small` 384-dim vía `Supabase.ai.Session` | Indexado en pgvector |
| Pagos | `@paypal/react-paypal-js` + REST + Webhooks · NOWPayments · Pago Móvil VE · Binance Pay | 3 pasarelas → un solo `saas_invoices` |
| PWA | `@ducanh2912/next-pwa` (custom SW) | Instalable + offline |
| Push | Web Push + VAPID | Notificaciones nativas |
| Observabilidad | Sentry · Axiom · Vercel Logs · `ai_traces` propio | Errores + métricas + trazas LLM |
| Testing | Vitest · Playwright · React Testing Library · MSW · **pgTAP** | **1.410 tests unitarios** (118 files) · **16 specs E2E** (Playwright) · **138 asserts pgTAP** (9+43+86) · integración Supabase local (7 archivos) · + tests Deno de Edge Functions |
| Quality gates | ESLint · Husky · lint-staged · pre-push (lint+tsc+test+audit) | No bypass |

---

## Arquitectura de alto nivel

```
                ┌─────────────────────────────────────────────┐
                │ CANALES                                     │
                │                                             │
   Owner (voz) ─►  voice-worker Edge (Deno)                  │
                │   capability registry → fast-path | LLM    │
                │   STT Deepgram + TTS Deepgram              │
                │                                             │
   Cliente (WA)►  whatsapp-webhook → QStash → process-whatsapp│
                │   ReAct loop 8B + síntesis 70B (saltable)  │
                │                                             │
   Cliente web ─► Next.js Dashboard (RSC + Server Actions)   │
                └──────────────────┬──────────────────────────┘
                                   │
                                   ▼
                ┌─────────────────────────────────────────────┐
                │ SEGURIDAD                                   │
                │   Supabase Auth + RLS (current_business_id) │
                │   repos filtrados (.eq business_id)         │
                └──────────────────┬──────────────────────────┘
                                   │
                                   ▼
                ┌─────────────────────────────────────────────┐
                │ DOMINIO                                     │
                │   Server Actions → domain use-cases         │
                │   ├─ Zod validation                         │
                │   ├─ conflict check                         │
                │   └─ repos + cache.invalidate               │
                └──────────────────┬──────────────────────────┘
                                   │
                                   ▼
                ┌─────────────────────────────────────────────┐
                │ DATOS                                       │
                │   Supabase (Postgres 15 + RLS + pgvector)   │
                │   Upstash Redis (sesión + rate-limits)      │
                │   QStash (back-pressure + retries)          │
                └─────────────────────────────────────────────┘

                ┌─────────────────────────────────────────────┐
                │ MEMORIA + OBSERVABILIDAD                    │
                │   ai_memories_v2  ──► MemoryEngine.recall   │
                │   ai_traces       ──► Tracer per turn       │
                │   ai_training_exports ◄── cron 03:00 UTC    │
                └─────────────────────────────────────────────┘

                ┌─────────────────────────────────────────────┐
                │ PAGOS                                       │
                │   PayPal → fn_finalize_paypal_payment (RPC) │
                │   NOWPayments → QStash → queue worker       │
                │   Manual → admin approval                   │
                └─────────────────────────────────────────────┘
```

---

## Módulos core (rutas verificadas)

| Módulo | Código | Tests |
|---|---|---|
| Agente WhatsApp (pipeline) | `supabase/functions/process-whatsapp/` → `message-pipeline.ts` | `__tests__/edge-functions/` |
| Asistente voz dashboard (pipeline) | `supabase/functions/voice-worker/` → `voice-pipeline.ts` | `supabase/functions/voice-worker/capabilities/*/__tests__/` |
| Pipeline Engine | `supabase/functions/_shared/pipeline/Pipeline.ts` | `_shared/pipeline/__tests__/` (21 tests: unit + property + load) |
| Saludo proactivo (voz) | `app/api/assistant/proactive/` + `lib/ai/tools/finance.tools.ts` (`get_today_summary`) | — |
| Constitutional Reviewer | `lib/ai/supervisor/` + `_shared/supervisor/` | `__tests__/ai/supervisor/` |
| Semantic Router | `lib/ai/router/` + `_shared/router/` | `__tests__/ai/router/` |
| Memory Engine | `lib/ai/memory/` + `_shared/memory/` | `__tests__/ai/memory/` |
| Observability | `lib/ai/observability/` + `_shared/observability/` | `__tests__/ai/observability/` |
| Training exporter | `lib/ai/training/` + `_shared/training/` + `supabase/functions/export-ai-traces/` | `__tests__/ai/training/` |
| PayPal | `lib/payments/paypal.ts` + `app/api/webhooks/paypal/` + RPC `fn_finalize_paypal_payment` | `__tests__/actions/` + `tests/e2e/payment-flow.spec.ts` |
| NOWPayments | `lib/payments/nowpayments.ts` + `app/api/webhooks/nowpayments/` + `app/api/queue/process-saas-payment/` | `lib/payments/nowpayments.test.ts` |
| Referidos | RPC `fn_apply_referral_bonus` (llamada desde `fn_finalize_paypal_payment`) + `lib/referrals/rewards.ts` (UI) | `__tests__/components/referral-client.test.tsx` |
| Notificaciones | `lib/hooks/use-in-app-notifications.ts` + tabla `notifications` | components tests |
| Reenganche de clientes (win-back) | `lib/domain/use-cases/retention/` (`GetEligibleClientsUseCase`, `ProcessRetentionUseCase`) + `app/api/cron/retention/` + opt-out en `process-whatsapp/retention-optout.ts` | tests de use-cases + `__tests__/retention-optout.test.ts` |
| Repositorios | `lib/repositories/Supabase*Repository.ts` | `lib/repositories/__tests__/` |
| Use cases | `lib/domain/use-cases/` | `__tests__/domain/use-cases/` |

---

## Estructura del proyecto (real)

```
cronix/
├── app/
│   ├── [locale]/                      ← rutas i18n
│   │   ├── dashboard/
│   │   │   ├── plans/                 ← plan + referidos
│   │   │   ├── settings/              ← perfil, billing, branding
│   │   │   ├── admin/payments/        ← aprobación manual (platform_admin)
│   │   │   ├── appointments/
│   │   │   ├── clients/
│   │   │   ├── finances/
│   │   │   └── profile/
│   │   ├── invite/[code]/             ← landing referidos
│   │   ├── register/                  ← captura ?ref=
│   │   └── login/
│   ├── api/
│   │   ├── webhooks/{paypal,nowpayments}/
│   │   ├── queue/process-saas-payment/
│   │   ├── cron/check-subscriptions/
│   │   ├── assistant/{proactive,token,tts}/
│   │   ├── passkey/{register,authenticate}/
│   │   ├── admin/users/[id]/status/
│   │   └── health/
│   └── auth/callback/
│
├── lib/
│   ├── ai/
│   │   ├── tools/                     ← get_today_summary (saludo voz) + tenantGuard
│   │   ├── memory/                    ← pgvector + gte-small
│   │   ├── observability/             ← Tracer + PgTraceSink
│   │   ├── router/                    ← SemanticRouter + intents
│   │   ├── supervisor/                ← ConstitutionalReviewer
│   │   ├── training/                  ← TrainingExporter
│   │   ├── providers/                 ← Groq, Deepgram
│   │   ├── circuit-breaker.ts
│   │   ├── resilience.ts
│   │   └── with-tenant-guard.ts
│   ├── domain/
│   │   ├── use-cases/                 ← business logic
│   │   └── repositories/              ← interfaces (DIP)
│   ├── repositories/                  ← implementaciones Supabase
│   ├── payments/                      ← paypal + nowpayments + subscription-fulfillment + bcv-rate
│   ├── referrals/
│   ├── plans/
│   ├── supabase/                      ← clients (server, client, middleware, admin)
│   ├── rate-limit/
│   ├── security/
│   ├── auth/
│   └── i18n/
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── pipeline/              ← Pipeline Engine (step orchestrator)
│   │   │   ├── booking-adapter.ts     ← WhatsApp booking adapter
│   │   │   ├── memory/                ← pgvector recall
│   │   │   ├── observability/         ← tracing
│   │   │   ├── supervisor/            ← constitutional guard
│   │   │   └── ...                    ← duplicado byte-by-byte de lib/ai/* (parity-tested)
│   │   ├── voice-worker/              ← Deno, capability registry → voice-pipeline.ts
│   │   ├── process-whatsapp/          ← Deno, message-pipeline.ts
│   │   ├── whatsapp-webhook/          ← HMAC verify + QStash publish
│   │   ├── whatsapp-service/          ← outbound API
│   │   ├── cron-reminders/            ← recordatorios
│   │   ├── push-notify/               ← Web Push VAPID
│   │   ├── embed-text/                ← Supabase.ai.Session('gte-small')
│   │   └── export-ai-traces/          ← cron 03:00 UTC
│   └── migrations/                    ← 85 migraciones
│
├── __tests__/                         ← 118 unit test files (components, auth, api, ai, actions, validations, use-cases, …)
├── tests/
│   ├── e2e/                           ← 16 Playwright specs (auth, dashboard, business flows)
│   └── integration/                   ← 7 Vitest files (Supabase local)
│
├── messages/                          ← i18n JSON (6 idiomas)
├── docs/
│   ├── architecture/
│   │   ├── AI_SYSTEM.md
│   │   ├── WHATSAPP_AGENT.md
│   │   ├── PAYMENTS.md
│   │   ├── RELIABILITY.md
│   │   ├── DATABASE_SECURITY_TESTING.md
│   │   ├── FRONTEND_ARCHITECTURE_AND_STATE.md
│   │   ├── PASSKEY_WEBAUTHN_IMPLEMENTATION.md
│   │   ├── WEB_PUSH_STANDARDS_DEEP_DIVE.md
│   │   ├── UX_ENGINEERING.md
│   │   └── adr/                       ← 0001..0008 ADRs
│   ├── operations/
│   │   ├── CI_CD_GATEKEEPER.md
│   │   ├── DEPRECATED_APIS.md
│   │   └── postmortems/
│   ├── api/ASSISTANT_TOOLS.md
│   ├── requirements/REQUIREMENTS_SPECIFICATION.md
│   ├── security/{SECURITY_AND_RATE_LIMITS,dependency-policy}.md
│   ├── internal/TESTING.md
│   └── specs/                         ← Spec-Driven Development: constitution.md + manifest.md por módulo
│
├── CHANGELOG.md
└── README.md
```

---

## Instalación local

### Requisitos
- Node.js 20+ (LTS)
- Docker Desktop (para Supabase local)
- Cuentas: Supabase, Upstash Redis + QStash, Groq, Deepgram, PayPal Developer (Sandbox)

### Pasos

```bash
git clone https://github.com/ROMEROLUIS15/cronix.git
cd cronix
npm install
cp .env.local.example .env.local         # editar con tus credenciales

npx supabase start                       # levanta Postgres + Edge + Studio
npx supabase db reset                    # aplica migraciones + seed
npx supabase gen types typescript --local > types/database.types.ts

npm run seed:intents                     # genera intent-embeddings.generated.json
npm run e2e:setup                        # siembra datos para E2E (opcional)

npm run dev                              # http://localhost:3000
```

Supabase Studio queda en `http://127.0.0.1:54323`.

### Scripts

```bash
npm run dev                # Next.js + Turbopack
npm run build              # Build producción
npm run lint               # ESLint
npm run typecheck          # tsc --noEmit
npm test                   # Vitest unit (1.410 tests, 118 files)
npm run test:integration   # Integration vs Supabase local (7 archivos)
npm run test:e2e           # Playwright (16 specs)
npm run test:e2e:smoke     # Suite reducida
npm run test:coverage      # Coverage v8
npx supabase test db       # pgTAP: database tests (138 asserts: RLS + funciones + alertas)
npm run seed:intents       # Regenerar embeddings de intents
```

### Testing — 1.410 unit (Vitest) + 16 E2E (Playwright) + 138 pgTAP

Vea [`docs/internal/TESTING.md`](./docs/internal/TESTING.md) para descripción completa.

**pgTAP (PostgreSQL Testing) — 138 asserts:**
- `docs/testing/PGTAP.md` — Qué es pgTAP, por qué y cuándo usarlo
- `docs/testing/PGTAP_EXAMPLES.md` — ejemplos concretos (RLS, pagos, rate-limiting)
- `supabase/tests/rls_policies.test.sql` — 86 asserts de Row-Level Security
- `supabase/tests/critical_functions.test.sql` — 43 asserts de funciones RPC críticas
- `supabase/tests/ai_agent_alerts.test.sql` — 9 asserts de alertas del agente

Ejecutar: `npx supabase test db`

### Quality gates automatizados

- **Pre-commit (Husky + lint-staged)**: `eslint --fix` sobre staged.
- **Pre-push**: `lint` + `tsc --noEmit` + `vitest run` + `npm audit`. Cualquier fallo cancela el push.

---

## Variables de entorno

`.env.local.example` documenta todas. Resumen:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth (Google OAuth)
ID_CLIENTE_GOOGLE=
SECRETO_CLIENTE_GOOGLE=

# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=

# AI
LLM_API_KEY=                # Groq, comma-separated para key rotation
GEMINI_API_KEY=             # opcional
LLM_PROVIDER=groq           # o "gemini", "gemini,groq"
DEEPGRAM_AURA_API_KEY=
CEREBRAS_API_KEY=           # opcional, fallback Node-side

# Upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
QSTASH_URL=https://qstash.upstash.io

# Pagos
NEXT_PUBLIC_PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
# PAYPAL_ENV=live           # opt-in explícito (default Sandbox)
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1

# Push
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:soporte@TU_DOMINIO
CRON_SECRET=

# Observabilidad
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
NEXT_PUBLIC_AXIOM_DATASET=
AXIOM_TOKEN=

# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000
APP_URL=http://localhost:3000
```

`.env.local` está en `.gitignore`. **Nunca commitear credenciales reales.**

---

## Seguridad multi-tenant — 3 capas independientes

Falla en una capa NO compromete las otras.

| Capa | Mecanismo | Falla por |
|---|---|---|
| 1 | **Repositorios filtrados** + ownership asserts | `.eq('business_id', ctx.businessId)` en TODA query + assert antes de `update`/`delete` |
| 2 | **Row Level Security en Postgres** (`current_business_id()` del JWT) | Aún con admin key comprometido, RLS bloquea cross-tenant reads/writes |
| 3 | **`ConstitutionalReviewer`** (Groq 8B semántico, writes de IA WhatsApp/voz) | Bloquea con códigos `TENANT_MISMATCH`, `AMBIGUOUS_TARGET`, `DUPLICATE_INTENT`, `CONTRADICTS_MEMORY`, `POLICY_VIOLATION`, `UNSAFE_ARGS` |

> El único tool de IA Node aún vivo (`get_today_summary`, lectura para el saludo) además llama `tenantGuard.verify()` contra `users.business_id`.

Detalle: [`docs/architecture/AI_SYSTEM.md`](./docs/architecture/AI_SYSTEM.md) §10 y [`docs/architecture/DATABASE_SECURITY_TESTING.md`](./docs/architecture/DATABASE_SECURITY_TESTING.md).

---

## Pipeline Engine

El `Pipeline<T>` en `supabase/functions/_shared/pipeline/Pipeline.ts` reemplazó los loops monolíticos de ambos agentes:

```
Pipeline<T>
  .step(name, fn)                       ← define paso
  .step(name, fn, { if: predicate })    ← paso condicional
  .step(name, fn, { timeoutMs: 500 })   ← paso con timeout
  .on({ onStepStart, onStepComplete })  ← hooks de observabilidad
  .run(initial) → { context, results }  ← ejecuta
```

**WhatsApp** (message-handler.ts: refactor original 337→281 líneas; hoy 296 tras nuevas capacidades):
  fetch-context → run-agent → send-response → log-interaction

**Voice** (agent.ts: refactor original 506→226 líneas; hoy 284 tras nuevas capacidades):
  llm-loop → build-output

Propiedades: tipado genérico, merge monotónico de contexto, parada en error, 21 tests (unit + property-based con fast-check + load).

---

## Patrones anti-alucinación — 10 mecanismos verificables

1. Corpus mention guards (servicio/cliente/fecha/hora deben rastrearse a algo que el usuario dijo).
2. Fast-paths sin LLM (12 capabilities en `voice-worker/capabilities/`, todas con `bypassLLM: true`).
3. Date guard determinista (`detectTemporalIntent` en `voice-pipeline.ts`).
4. Frame-cutoff del corpus (`voice-worker/capabilities/schedule/tool.ts`).
5. Per-turn fingerprint dedup `(tool + sorted args)`.
6. Response bypass (flag `bypassLLM` en `ICapability`).
7. Confirmation gate 2-turn (`confirmation-gate.ts`).
8. Embedded `<function>` recovery (`process-whatsapp/ai-agent.ts`).
9. Router semántico (9 intents, threshold 0.78).
10. Constitutional reviewer (Groq 8B, rubric v4, fail-open salvo `delete_client` que escala a hard-block).

Detalle: [`docs/architecture/AI_SYSTEM.md`](./docs/architecture/AI_SYSTEM.md).

---

## Sistema de pagos

| Pasarela | Webhook | Idempotencia |
|---|---|---|
| **PayPal** | `/api/webhooks/paypal` (PayPal `/v1/notifications/verify-webhook-signature`) | RPC `fn_finalize_paypal_payment` (FOR UPDATE) |
| **NOWPayments (cripto)** | `/api/webhooks/nowpayments` → QStash → `/api/queue/process-saas-payment` | Status-based + `np_invoice_id` único |
| **Manual (Pago Móvil VE + Binance)** | n/a | Aprobación admin |

`fn_apply_referral_bonus` (RPC, invocada desde `fn_finalize_paypal_payment`) dispara solo al primer pago `finished` del referido → +30 días al referrer.

Detalle: [`docs/architecture/PAYMENTS.md`](./docs/architecture/PAYMENTS.md).

---

## Decisiones arquitectónicas clave

- **Por qué Pipeline Engine custom en vez de LangChain/LangGraph** — Deno 1.x no soporta dependencias Node.js de LangChain; un Pipeline<T> de ~106 líneas reemplaza 10MB de deps. [ADR-0005](./docs/architecture/adr/0005-custom-pipeline-engine-over-langchain.md)
- **Por qué booking-adapter.ts para WhatsApp pero no para Voice** — WhatsApp identifica clientes por teléfono (adapter directo); Voice los identifica por nombre con resolución de ambigüedad + validación anti-alucinación. [ADR-0006](./docs/architecture/adr/0006-booking-engine-dual-implementation.md)
- **Por qué 4 agentes (Orchestrator, Booking, Client, Supervisor)** — cobertura completa sin fragmentación excesiva; cada agente es un step del Pipeline. [ADR-0007](./docs/architecture/adr/0007-four-agent-architecture-decomposition.md)
- **Por qué import maps en vez de Turborepo** — Edge Functions no pueden instalar npm packages; import maps resuelven el sharing sin build step. [ADR-0008](./docs/architecture/adr/0008-import-maps-over-shared-packages.md)
- **Por qué duplicación lib/ai/ ↔ _shared/ con parity tests** — Edge Functions Deno no pueden importar módulos Node; duplicar + test garantiza zero drift.
- **Por qué RLS como red estructural** — el `businessId` puede llegar de un cliente/LLM; RLS (derivado del JWT vía `current_business_id()`) bloquea cross-tenant a nivel DB independientemente del código de aplicación. Los repos además filtran por `business_id` en toda query.
- **Por qué `PAYPAL_ENV=live` es opt-in** — Vercel inyecta `NODE_ENV=production` en previews; usar `NODE_ENV` cobraría dinero real en cada PR.
- **Por qué fail-open en el reviewer** — un reviewer flaky no debe bloquear bookings legítimos; los códigos `block` solo disparan ante incoherencia semántica clara.
- **Por qué template determinista en WhatsApp success path** — cortar el segundo LLM call elimina el loop `400 → circuit-breaker → 503` observado cuando el 8B fallaba la síntesis.
- **Por qué Zod como single source of truth** — un schema sirve simultáneamente como validador runtime y como `function.parameters` para el LLM.
- **Por qué confirmation-gate pasa tools vacías al modelo** — eliminar la superficie de alucinación es más barato que sanitizar la salida del modelo.

---

## Documentación detallada

- [`docs/architecture/AI_SYSTEM.md`](./docs/architecture/AI_SYSTEM.md) — Sistema de IA: modelos, capas anti-alucinación, booking por canal, memoria, router, observabilidad, training exporter, parity, fallback chain, resilience.
- [`docs/architecture/WHATSAPP_AGENT.md`](./docs/architecture/WHATSAPP_AGENT.md) — Agente WA end-to-end: pipeline, 6 defensas anti-abuso, confirmation gate, recuperación de tool-calls, final-pass determinista.
- [`docs/architecture/PAYMENTS.md`](./docs/architecture/PAYMENTS.md) — PayPal + NOWPayments + manual: webhooks, idempotencia, referidos, migraciones, seguridad.
- [`docs/architecture/RELIABILITY.md`](./docs/architecture/RELIABILITY.md) — Circuit breaker + QStash retries.
- [`docs/architecture/DATABASE_SECURITY_TESTING.md`](./docs/architecture/DATABASE_SECURITY_TESTING.md) — RLS audit + adversarial tests.
- [`docs/architecture/FRONTEND_ARCHITECTURE_AND_STATE.md`](./docs/architecture/FRONTEND_ARCHITECTURE_AND_STATE.md) — App Router + RSC + TanStack Query.
- [`docs/architecture/PASSKEY_WEBAUTHN_IMPLEMENTATION.md`](./docs/architecture/PASSKEY_WEBAUTHN_IMPLEMENTATION.md) — WebAuthn server + browser.
- [`docs/architecture/WEB_PUSH_STANDARDS_DEEP_DIVE.md`](./docs/architecture/WEB_PUSH_STANDARDS_DEEP_DIVE.md) — VAPID + push subscriptions.
- [`docs/architecture/UX_ENGINEERING.md`](./docs/architecture/UX_ENGINEERING.md) — patterns de UX en el dashboard.
- [`docs/architecture/adr/`](./docs/architecture/adr/) — ADR-0001..0008:
  - 0001: Action Tags vs JSON Function Calling
  - 0002: Next.js Upgrade Deferral
  - 0003: WhatsApp Concurrency Queues
  - 0004: WhatsApp Business Verification
  - **0005: Pipeline Engine custom sobre LangChain/LangGraph**
  - **0006: Implementaciones de booking por canal (sin engine compartido)**
  - **0007: 4-agent architecture decomposition**
  - **0008: Import maps sobre Turborepo**
- [`docs/operations/CI_CD_GATEKEEPER.md`](./docs/operations/CI_CD_GATEKEEPER.md) — gates pre-commit/pre-push.
- [`docs/security/SECURITY_AND_RATE_LIMITS.md`](./docs/security/SECURITY_AND_RATE_LIMITS.md) + [`dependency-policy.md`](./docs/security/dependency-policy.md).
- [`docs/internal/TESTING.md`](./docs/internal/TESTING.md) — suite, scripts, tests críticos.

---

## Licencia

Privado. Todos los derechos reservados.
