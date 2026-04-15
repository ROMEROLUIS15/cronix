# Cronix — AI-Powered Scheduling SaaS

> Production-grade multi-tenant platform for service businesses. Voice-first AI orchestration, enterprise security, clean architecture.

**Stack**: Next.js 15 · Supabase · Groq · Deepgram · Upstash Redis · Vercel  
**Architecture**: App Router · Clean Architecture · CQRS · Repository Pattern · RLS

---

## Platform Capabilities

### Voice AI Assistant (Luis)
- Full **ReAct orchestration loop** — reason → call tool → reason again until resolved
- **7 production tools**: book, cancel, reschedule, list appointments, list services, check availability, register client
- **Snake_case field contracts** — Zod schemas match LLM tool definitions exactly, zero silent mismatches
- **Tool call history propagation** — full message chain preserved across turns, enabling multi-step reasoning
- **Redis-persisted conversation state** — survives serverless cold starts, TTL-scoped per session
- **RBAC strategy pattern** — owner/staff get all tools, external callers get a safe subset
- **Voice-optimized system prompt** — behavioral instructions, tool chaining flow, security rules, date format enforcement
- **Real token accounting** — Groq `usage.total_tokens` accumulated per turn, not estimated

### Intelligent Scheduling
- Conflict detection before every booking (CQRS query side)
- Working hours enforcement — no bookings outside configured hours, closed-day protection
- Available slots algorithm — subtracts booked intervals from working hours in 30-min increments
- Timezone-aware throughout — all times stored as ISO 8601, displayed per business timezone

### Multi-Tenant Security
- **Row-Level Security (RLS)** on every table — zero cross-tenant data access at the DB layer
- **Passkey / WebAuthn** — passwordless, phishing-proof authentication (SimpleWebAuthn)
- **OAuth 2.0** — Google Sign-In with secure session management
- **CSRF protection** — double-submit cookie pattern via middleware chain
- **Rate limiting** — Redis token bucket at API layer + Supabase RLS quota
- **CSP + COOP/CORP headers** — strict Content Security Policy, cross-origin isolation
- **Middleware composition** — session, CSRF, rate-limit, user-status checks stacked cleanly

### Financial Tracking
- Idempotency keys on every transaction — no duplicate payments
- Batch transaction inserts — atomic multi-service payment recording
- Revenue aggregation pushed to DB — `SUM(net_amount)` in SQL, not in JS

### Notifications
- **WhatsApp** — inbound webhook + outbound messages via Twilio/Meta API
- **Web Push** — PWA-native, VAPID-signed, subscription management
- **In-app** — real-time notification panel with action history
- **Cron reminders** — Supabase `pg_cron` → Edge Function pipeline, tenant-aware scheduling

---

## Architecture

### High-Level Request Flow

```
Browser / PWA
    │
    ▼ HTTPS
Next.js Middleware Chain
  [session] → [csrf] → [rate-limit] → [user-status] → [request-id]
    │
    ▼
App Router (app/)
  ├── Page Routes ([locale]/dashboard/...)
  │     └── Server Components + Client Components
  │           └── lib/actions/*.ts (Server Actions)
  │
  └── API Routes (app/api/)
        ├── /assistant/voice      ← Voice AI entry point
        ├── /passkey/...          ← WebAuthn ceremony
        ├── /activity/ping        ← Audit log
        ├── /admin/...            ← Admin operations
        └── /health               ← System health check
    │
    ▼
lib/ — Application Core
  ├── ai/orchestrator/           ← AI orchestration layer
  ├── domain/use-cases/          ← Business logic (pure)
  ├── domain/repositories/       ← Repository interfaces (contracts)
  ├── repositories/              ← Supabase implementations
  └── middleware/                ← Composable middleware handlers
    │
    ▼
Supabase (PostgreSQL + Edge Functions)
  ├── RLS policies               ← Tenant isolation
  ├── pg_cron                    ← Scheduled jobs
  └── Edge Functions             ← WhatsApp, push, reminders, embeddings
    │
    ▼
External Services
  ├── Groq              ← LLM (llama) + STT (Whisper)
  ├── Deepgram          ← TTS (Aura 2, Spanish)
  └── Upstash Redis     ← Session state + rate limit counters
```

### AI Orchestrator Detail

```
POST /api/assistant/voice
    │
    ├─ Groq Whisper → transcript
    │
    ├─ orchestrator-factory.ts → AiOrchestrator
    │       │
    │       ├─ RedisStateManager.load(sessionId)
    │       │     └─ ConversationState { flow, turnCount, draft, history }
    │       │
    │       ├─ DecisionEngine.analyze(input, state)
    │       │     ├─ Fast path: execute_immediately (confirmed action)
    │       │     ├─ Fast path: reject (turn limit / rejection keyword)
    │       │     └─ LLM path: reason_with_llm { messages, toolDefs }
    │       │           ├─ buildSystemPrompt() — injects services, hours, appointments,
    │       │           │    voice format rules, tool chaining flow, security rules
    │       │           └─ buildToolDefsForRole(strategy) — RBAC-filtered tool list
    │       │
    │       ├─ ExecutionEngine.execute(decision)
    │       │     loop (max 5 steps):
    │       │       ├─ LlmBridge → GroqProvider.chat(messages, toolDefs)
    │       │       │     └─ returns: text | tool_call + real token count
    │       │       └─ [tool_call] RealToolExecutor.execute(toolName, args)
    │       │               ├─ Zod schema validation (snake_case, exact match)
    │       │               └─ UseCase → IRepository → Supabase
    │       │
    │       ├─ RedisStateManager.save(nextState)
    │       │     └─ { flow, turnCount reset on action, history.slice(-20) }
    │       │
    │       └─ AiOutput { text, actionPerformed, tokens }
    │
    └─ Deepgram Aura 2 → audio/mpeg response
```

### Domain Layer (Clean Architecture)

```
lib/domain/
├── repositories/                  ← Pure TypeScript interfaces (no Supabase)
│   ├── IAppointmentQueryRepository  (CQRS read side)
│   ├── IAppointmentCommandRepository (CQRS write side)
│   ├── IClientRepository
│   ├── IServiceRepository
│   ├── IFinanceRepository
│   ├── IBusinessRepository
│   ├── IUserRepository
│   ├── INotificationRepository
│   └── IReminderRepository
│
└── use-cases/                     ← Business logic, depends only on interfaces
    ├── CreateAppointmentUseCase     (conflict check → insert)
    ├── CancelAppointmentUseCase
    ├── RescheduleAppointmentUseCase (conflict check → update)
    ├── GetAppointmentsByDateUseCase (filter + format)
    ├── GetAvailableSlotsUseCase     (working hours − booked = free slots)
    ├── CreateClientUseCase          (validate + insert → returns id)
    ├── GetClientsUseCase
    └── RegisterPaymentUseCase
```

---

## Full Project Tree

```
cronix/
│
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx
│   │   ├── page.tsx                        # Landing / redirect
│   │   ├── login/                          # Passkey + Google OAuth
│   │   ├── register/                       # Business onboarding
│   │   ├── forgot-password/
│   │   ├── reset-password/
│   │   ├── terms/ & privacy/
│   │   └── dashboard/
│   │       ├── page.tsx                    # Main calendar view
│   │       ├── layout.tsx                  # Sidebar + shell
│   │       ├── appointments/               # List, new, edit
│   │       ├── clients/                    # List, detail, edit, new
│   │       ├── finances/                   # Dashboard, transactions, expenses
│   │       ├── services/                   # Service manager
│   │       ├── team/                       # Staff management
│   │       ├── reports/                    # Revenue & analytics
│   │       ├── settings/                   # Tenant branding + AI config
│   │       ├── profile/                    # User profile
│   │       ├── setup/                      # First-time business setup
│   │       └── admin/
│   │           └── pulse/                  # System health + dead-letter log
│   │
│   ├── api/
│   │   ├── assistant/
│   │   │   ├── voice/route.ts              # ★ Voice AI entry point (STT→AI→TTS)
│   │   │   ├── tts/route.ts                # Standalone TTS endpoint
│   │   │   ├── token/route.ts              # Session token for voice client
│   │   │   └── proactive/route.ts          # Proactive AI messages
│   │   ├── passkey/
│   │   │   ├── authenticate/options/       # WebAuthn challenge
│   │   │   └── authenticate/verify/        # WebAuthn verification
│   │   ├── activity/ping/route.ts          # Audit event ingestion
│   │   ├── admin/users/[id]/status/        # Admin user management
│   │   └── health/route.ts                 # DB + Redis + external health
│   │
│   ├── auth/callback/route.ts              # OAuth callback handler
│   ├── layout.tsx                          # Root layout + providers
│   └── global-error.tsx
│
├── lib/
│   │
│   ├── ai/
│   │   ├── orchestrator/                   # ★ Production AI orchestration
│   │   │   ├── ai-orchestrator.ts          # Public facade (AiOrchestrator)
│   │   │   ├── decision-engine.ts          # Analyze input → Decision + system prompt
│   │   │   ├── execution-engine.ts         # ReAct loop (max 5 steps)
│   │   │   ├── LlmBridge.ts               # ExecutionEngine ↔ GroqProvider adapter
│   │   │   ├── state-manager.ts            # IStateManager interface
│   │   │   ├── RedisStateManager.ts        # Upstash Redis implementation
│   │   │   ├── strategy.ts                 # RBAC strategies (Internal/External)
│   │   │   ├── orchestrator-factory.ts     # Wires repos → RealToolExecutor → AiOrchestrator
│   │   │   ├── types.ts                    # AiInput, AiOutput, ConversationState, Decision
│   │   │   ├── index.ts                    # Barrel exports
│   │   │   ├── example.ts                  # Dev/docs usage example
│   │   │   └── tool-adapter/
│   │   │       ├── RealToolExecutor.ts     # ★ Maps tool names → UseCases (7 tools)
│   │   │       └── tool-adapter.ts         # IToolExecutor interface
│   │   │
│   │   ├── providers/
│   │   │   ├── groq-provider.ts            # LLM + Whisper STT (function calling)
│   │   │   ├── deepgram-provider.ts        # Aura 2 TTS
│   │   │   ├── elevenlabs-provider.ts      # Legacy TTS (unused)
│   │   │   └── types.ts                    # LlmResult, SttResult, TtsResult
│   │   │
│   │   ├── fuzzy-match.ts                  # Levenshtein client/service resolution
│   │   ├── output-shield.ts                # LLM response safety filter
│   │   ├── circuit-breaker.ts              # Resilience (open/half-open/closed)
│   │   ├── resilience.ts                   # Retry + timeout wrappers
│   │   ├── session-store.ts                # Legacy session (superseded by Redis)
│   │   ├── memory.ts                       # RAG memory types
│   │   ├── memory-service.ts               # pgvector embedding queries
│   │   ├── assistant-prompt.ts             # Legacy prompt builder
│   │   ├── assistant-service.ts            # Legacy orchestrator (superseded)
│   │   ├── assistant-tools.ts              # Legacy tool definitions (superseded)
│   │   ├── intent-router.ts                # Legacy intent classifier (superseded)
│   │   ├── tool-registry.ts                # Legacy tool registry (superseded)
│   │   ├── tool-definitions.read.ts        # Legacy read tool defs (superseded)
│   │   ├── tool-definitions.write.ts       # Legacy write tool defs (superseded)
│   │   ├── with-tenant-guard.ts            # Tenant validation wrapper
│   │   ├── types.ts                        # Legacy AI types
│   │   ├── prompts/luis.prompt.ts          # Legacy system prompt (superseded)
│   │   └── tools/                          # Legacy tool implementations (superseded)
│   │       ├── appointment.tools.ts
│   │       ├── client.tools.ts
│   │       ├── crm.tools.ts
│   │       ├── finance.tools.ts
│   │       └── index.ts
│   │
│   ├── domain/
│   │   ├── repositories/                   # ★ Pure interfaces (no infrastructure)
│   │   │   ├── IAppointmentQueryRepository.ts
│   │   │   ├── IAppointmentCommandRepository.ts
│   │   │   ├── IAppointmentRepository.ts
│   │   │   ├── IBusinessRepository.ts
│   │   │   ├── IClientRepository.ts
│   │   │   ├── IFinanceRepository.ts
│   │   │   ├── INotificationRepository.ts
│   │   │   ├── IReminderRepository.ts
│   │   │   ├── IServiceRepository.ts
│   │   │   ├── IUserRepository.ts
│   │   │   └── index.ts
│   │   ├── use-cases/                      # ★ Business logic layer
│   │   │   ├── CreateAppointmentUseCase.ts
│   │   │   ├── CancelAppointmentUseCase.ts
│   │   │   ├── RescheduleAppointmentUseCase.ts
│   │   │   ├── GetAppointmentsByDateUseCase.ts
│   │   │   ├── GetAvailableSlotsUseCase.ts
│   │   │   ├── CreateClientUseCase.ts
│   │   │   ├── GetClientsUseCase.ts
│   │   │   ├── RegisterPaymentUseCase.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   └── errors/DomainError.ts
│   │
│   ├── repositories/                       # ★ Supabase implementations
│   │   ├── SupabaseAppointmentRepository.ts
│   │   ├── SupabaseBusinessRepository.ts
│   │   ├── SupabaseClientRepository.ts
│   │   ├── SupabaseFinanceRepository.ts
│   │   ├── SupabaseNotificationRepository.ts
│   │   ├── SupabaseReminderRepository.ts
│   │   ├── SupabaseServiceRepository.ts
│   │   └── SupabaseUserRepository.ts
│   │
│   ├── actions/                            # Next.js Server Actions
│   │   ├── auth.ts
│   │   ├── csrf-action.ts
│   │   ├── rate-limit-action.ts
│   │   └── voice-assistant.ts
│   │
│   ├── middleware/                         # Composable middleware chain
│   │   ├── compose.ts                      # Chain builder
│   │   ├── with-session.ts
│   │   ├── with-csrf.ts
│   │   ├── with-rate-limit.ts
│   │   ├── with-session-timeout.ts
│   │   ├── with-user-status.ts
│   │   ├── with-request-id.ts
│   │   ├── constants.ts
│   │   ├── utils.ts
│   │   └── index.ts
│   │
│   ├── rate-limit/
│   │   ├── redis-rate-limiter.ts           # Sliding window via Upstash
│   │   └── token-quota.ts                  # Per-user AI token budget
│   │
│   ├── auth/
│   │   ├── get-session.ts
│   │   └── get-business-id.ts
│   │
│   ├── hooks/                              # Shared React hooks
│   │   ├── use-business-context.ts
│   │   ├── use-fetch.ts
│   │   ├── use-in-app-notifications.ts
│   │   ├── use-notifications.ts
│   │   ├── use-pwa-install.ts
│   │   ├── use-pwa-update.ts
│   │   └── use-contact-picker.ts
│   │
│   ├── notifications/notify-owner-whatsapp.ts
│   ├── appointments/validate-double-booking.ts
│   ├── application/ai/                     # Application-layer AI planner/executor
│   │   ├── planner.ts
│   │   ├── executor.ts
│   │   └── types.ts
│   ├── container.ts                        # DI container (server)
│   ├── browser-container.ts                # DI container (client)
│   ├── cache.ts                            # In-memory cache helpers
│   ├── logger.ts                           # Axiom structured logger
│   ├── mock/data.ts                        # Test fixtures
│   ├── i18n/date-locale.ts
│   └── constants/
│       ├── business.ts
│       └── voice-agent.ts
│
├── components/
│   ├── ui/                                 # Design system primitives
│   │   ├── button.tsx, input.tsx, modal.tsx, card.tsx
│   │   ├── badge.tsx, skeleton.tsx, avatar.tsx
│   │   ├── date-time-picker.tsx
│   │   ├── client-select.tsx
│   │   ├── passkey-login-button.tsx
│   │   ├── phone-input-flags.tsx
│   │   ├── language-switcher.tsx
│   │   ├── password-input.tsx
│   │   └── pwa-install-banner.tsx / pwa-install-floating.tsx / pwa-update-toast.tsx
│   ├── dashboard/
│   │   ├── voice-assistant-fab.tsx         # Voice button + audio capture
│   │   ├── voice-visualizer.tsx            # Waveform animation
│   │   └── services-onboarding-banner.tsx
│   ├── layout/
│   │   ├── dashboard-shell.tsx
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   └── notification-panel.tsx
│   ├── admin/
│   │   ├── system-status-grid.tsx
│   │   └── dead-letter-feed.tsx
│   ├── providers.tsx                       # React context providers
│   ├── session-timeout.tsx
│   └── theme-toggle.tsx
│
├── supabase/
│   ├── migrations/                         # 45+ versioned SQL migrations
│   └── functions/                          # Deno Edge Functions
│       ├── _shared/
│       │   ├── supabase.ts                 # Admin client factory
│       │   ├── tenant-guard.ts             # Business ownership check
│       │   ├── database.ts                 # Shared DB types
│       │   └── sentry.ts                   # Error reporting
│       ├── process-whatsapp/               # WhatsApp AI agent (Deno)
│       │   ├── index.ts                    # Entry point + routing
│       │   ├── ai-agent.ts                 # Groq LLM orchestration
│       │   ├── prompt-builder.ts           # System prompt for WA context
│       │   ├── tool-executor.ts            # WA-specific tool implementations
│       │   ├── context-fetcher.ts          # Load business/client context
│       │   ├── business-router.ts          # Multi-tenant message routing
│       │   ├── message-handler.ts          # Inbound message processor
│       │   ├── appointment-repo.ts         # Appointment DB queries
│       │   ├── notifications.ts
│       │   ├── security.ts                 # Signature verification
│       │   ├── guards.ts
│       │   ├── audit.ts
│       │   └── types.ts
│       ├── whatsapp-webhook/               # Webhook receiver + queue dispatch
│       │   ├── index.ts
│       │   └── types.ts
│       ├── whatsapp-service/               # Outbound message sender
│       │   └── index.ts
│       ├── cron-reminders/                 # Appointment reminder pipeline
│       │   ├── index.ts
│       │   └── modules/
│       │       ├── appointment-fetcher.ts
│       │       ├── business-scheduler.ts
│       │       ├── notification-builder.ts
│       │       ├── whatsapp-sender.ts
│       │       ├── cleanup.ts
│       │       └── db.ts
│       ├── push-notify/                    # Web push dispatcher
│       │   ├── index.ts
│       │   ├── vapid.ts
│       │   └── modules/
│       │       ├── push-sender.ts
│       │       ├── subscription-manager.ts
│       │       └── auth.ts
│       └── embed-text/                     # pgvector embedding (RAG)
│           └── index.ts
│
├── types/
│   ├── database.types.ts                   # Auto-generated Supabase types
│   ├── query-types.ts                      # Derived query return types
│   ├── result.ts                           # Result<T> type (ok/fail)
│   └── index.ts
│
├── __tests__/                              # Unit + integration tests (Vitest)
│   ├── ai/                                 # AI module tests
│   ├── domain/                             # Domain layer tests
│   ├── use-cases/                          # UseCase tests
│   ├── contracts/                          # Repository contract tests
│   ├── rate-limit/                         # Rate limiter tests
│   ├── middleware/                         # Middleware chain tests
│   ├── security/                           # CSRF, auth tests
│   ├── validations/                        # Zod schema tests
│   └── components/                         # Component smoke tests
│
├── lib/repositories/__tests__/             # Supabase repository integration tests
│
├── playwright/                             # E2E tests (Playwright)
│
├── i18n/                                   # next-intl configuration
│   ├── routing.ts
│   ├── request.ts
│   ├── navigation.ts
│   └── middleware-interceptor.ts
│
├── docs/
│   ├── architecture/
│   │   ├── AI_MASTER_GUIDE.md              # ★ AI orchestrator deep dive
│   │   ├── DASHBOARD_ASSISTANT_TECHNICAL_OVERVIEW.md
│   │   ├── LUIS_IA_PROMPT_ENGINEERING.md   # ★ System prompt design guide
│   │   ├── TECHNICAL_DOCUMENTATION.md
│   │   ├── TECHNICAL_DOCUMENTATION_ES.md
│   │   ├── FRONTEND_ARCHITECTURE_AND_STATE.md
│   │   ├── RELIABILITY.md
│   │   ├── UX_ENGINEERING.md
│   │   ├── ADR-001-whatsapp-concurrency-queues.md
│   │   ├── ADR_002_ACTION_TAGS_VS_JSON.md
│   │   ├── ARCHITECTURE_DECISIONS.md
│   │   ├── DATABASE_SECURITY_TESTING.md
│   │   ├── PASSKEY_WEBAUTHN_IMPLEMENTATION.md
│   │   ├── WEB_PUSH_STANDARDS_DEEP_DIVE.md
│   │   └── WhatsApp-AI-Architecture-Details.md
│   ├── api/
│   │   └── ASSISTANT_TOOLS.md              # ★ All 7 AI tools reference
│   ├── security/
│   │   ├── SECURITY_AND_RATE_LIMITS.md
│   │   └── dependency-policy.md
│   ├── operations/
│   │   ├── CI_CD_GATEKEEPER.md
│   │   ├── DEPRECATED_APIS.md
│   │   └── WHATSAPP_FIX_POSTMORTEM.md
│   └── system-pulse.md
│
├── middleware.ts                            # Next.js middleware entry
├── instrumentation.ts                       # Server startup (Sentry)
├── instrumentation-client.ts               # Client startup (Sentry)
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 15 (App Router) | SSR, Server Actions, API routes |
| **Language** | TypeScript (strict) | No `any`, no `console.log` |
| **Database** | Supabase PostgreSQL | ACID, RLS, pg_cron, pgvector |
| **Auth** | Supabase Auth + SimpleWebAuthn | Passkey, OAuth, JWT sessions |
| **AI — LLM** | Groq (llama-3.x) | Function calling, fast inference |
| **AI — STT** | Groq Whisper (whisper-large-v3-turbo) | Voice-to-text, <1s latency |
| **AI — TTS** | Deepgram Aura 2 (aura-2-nestor-es) | Natural Spanish voice synthesis |
| **Session State** | Upstash Redis | AI conversation state, rate limit counters |
| **Job Queue** | Upstash QStash | Async WhatsApp message processing |
| **Edge Functions** | Supabase Deno runtime | WhatsApp agent, push, reminders, embeddings |
| **Monitoring** | Sentry + Axiom | Error tracking, structured logging |
| **Hosting** | Vercel (global edge) | CI/CD, preview deploys, domain routing |
| **Testing** | Vitest + Playwright | Unit, integration, E2E |

---

## AI Tool Catalog

| Tool | Access | Description |
|------|--------|-------------|
| `confirm_booking` | All | Create appointment. `service_id` + `date` + `time` + (`client_name` or `client_id`) |
| `cancel_booking` | All | Cancel by `appointment_id` |
| `reschedule_booking` | All | Move to new `date`/`time` by `appointment_id` |
| `get_appointments_by_date` | All | List active appointments with IDs for a day |
| `get_services` | All | List active services with prices and durations |
| `get_available_slots` | All | Free slots for a day given service `duration_min` |
| `create_client` | Internal only | Register new client → returns `client_id` for immediate chaining |

---

## Developer Setup

### Prerequisites
- Node.js 18+
- Docker (Supabase local dev)

### Installation

```bash
git clone <repo>
cd cronix
npm install

cp .env.example .env.local
# Fill: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#       GROQ_API_KEY, DEEPGRAM_API_KEY, UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN

npx supabase start
npx supabase migration up

npm run dev
# → http://localhost:3000
```

### Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # tsc --noEmit (strict, zero errors enforced)
npm run lint         # ESLint + Prettier
npm test             # Vitest (unit + integration)
npm run test:e2e     # Playwright E2E
npm run test:ui      # Vitest UI (watch mode)
npm run test:coverage
```

### Code Standards

- **No `any` types** — TypeScript strict mode throughout
- **No `console.log`** — use `lib/logger.ts` (Axiom structured logging)
- **Result<T> contract** — every repo/use-case returns `{ data, error }`, never throws
- **Snake_case in tool schemas** — must match LLM tool definition field names exactly
- **Dev/prod parity** — code runs identically in both environments

---

## CI/CD

```
Push to develop → pre-push hook (Husky)
  ├── ESLint + Prettier
  ├── TypeScript (tsc --noEmit)
  └── Vitest test suite

PR to main → same checks + code review

Merge to main → Vercel production deploy (2-3 min global rollout)
```

---

## Key Documentation

| Document | Description |
|----------|-------------|
| [AI_MASTER_GUIDE.md](docs/architecture/AI_MASTER_GUIDE.md) | Full AI orchestrator architecture, state machine, component reference |
| [ASSISTANT_TOOLS.md](docs/api/ASSISTANT_TOOLS.md) | All 7 tools: parameters, behavior, chaining patterns |
| [LUIS_IA_PROMPT_ENGINEERING.md](docs/architecture/LUIS_IA_PROMPT_ENGINEERING.md) | System prompt design, section-by-section breakdown |
| [DASHBOARD_ASSISTANT_TECHNICAL_OVERVIEW.md](docs/architecture/DASHBOARD_ASSISTANT_TECHNICAL_OVERVIEW.md) | Dashboard AI overview, RBAC, voice pipeline |
| [SECURITY_AND_RATE_LIMITS.md](docs/security/SECURITY_AND_RATE_LIMITS.md) | Threat model, RLS, rate limiting |
| [RELIABILITY.md](docs/architecture/RELIABILITY.md) | Circuit breaker, retry, resilience patterns |
| [WhatsApp-AI-Architecture-Details.md](docs/architecture/WhatsApp-AI-Architecture-Details.md) | WhatsApp agent architecture |
