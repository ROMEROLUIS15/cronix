# Cronix — Enterprise Appointment & Voice AI SaaS

**Cronix** is a comprehensive, production-grade SaaS platform for scheduling, client management, and intelligent voice-driven operations. Built on modern cloud-native architecture with security-first design.

> **Status**: Active development | **Version**: 0.1.0 | **Architecture**: Multitenant with Row-Level Security

---

## 🎯 Key Capabilities

### 📅 Intelligent Scheduling
- **Smart appointment management** with timezone awareness and automatic conflict detection
- **Adaptive slot algorithms** that optimize availability across multiple service types
- **Voice-enabled booking** through WhatsApp integration and AI assistant
- Real-time synchronization across all devices (PWA support)

### 🤖 Voice AI Assistant (Luis)
- **Multi-LLM support** (currently Groq) with fallback providers for resilience
- **Real-time speech-to-text** (Deepgram) with 99ms latency target
- **Natural speech synthesis** (Deepgram Aura 2) for conversational responses in Spanish
- **Context-aware memory** system that learns business operations and client preferences
- **Secure tool execution** (appointments, client lookup, finance queries) with audit logging

### 🔐 Enterprise Security
- **Row-Level Security (RLS)** on all data tables — zero cross-tenant data leakage
- **Passkey authentication** (WebAuthn) — passwordless, phishing-proof login
- **OAuth 2.0** integration (Google Sign-In) with secure token rotation
- **Face ID/Biometric support** via passkey protocol
- **Rate limiting** at application and database layers to prevent abuse
- **Content Security Policy (CSP)** with strict headers and CORS isolation
- **Audit logging** for all sensitive operations (AI tool calls, financial transactions, user actions)

### 💰 Financial Tracking
- **Transaction ledger** with idempotency keys for duplicate prevention
- **Multi-service pricing** per business unit
- **Revenue dashboards** with real-time metrics
- **Custom primary color branding** for tenant white-labeling

### 🔔 Multi-Channel Notifications
- **WhatsApp integration** (incoming webhooks + outgoing messages)
- **Web push notifications** (PWA-enabled)
- **In-app notifications** with action history
- **Appointment reminders** via email, SMS, and push
- **Cron-based scheduling** (Supabase pg_cron) for automated tasks

---

## 🏗️ Architecture Overview

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript | SSR/SSG + real-time interactivity |
| **Backend** | Next.js API Routes + Supabase Edge Functions | Serverless compute with auto-scaling |
| **Database** | PostgreSQL (Supabase) | ACID transactions, RLS, pg_cron automation |
| **Storage** | Supabase Storage (S3-compatible) | Logo/branding assets |
| **Auth** | Supabase Auth + SimpleWebAuthn | Passkey, OAuth, session management |
| **AI/ML** | Groq LLM, Deepgram STT + TTS (Aura 2) | Inference, speech recognition, synthesis |
| **Messaging** | Upstash QStash | Async job queuing |
| **Caching** | Upstash Redis | Session store, rate limit counters |
| **Monitoring** | Sentry + Axiom | Error tracking, structured logging |
| **CDN/Hosting** | Vercel | Global edge deployment |

### Core Entities

**Multitenant Business Model:**
- **Businesses** — Workspace with ownership and staff roles
- **Users** — Staff members (staff/owner role per business)
- **Clients** — External contacts for appointments
- **Appointments** — Scheduled services (pending → confirmed → completed)
- **Services** — Service types per business unit
- **Transactions** — Financial ledger with idempotency
- **Notifications** — Delivery status (WhatsApp, email, push, in-app)
- **WhatsApp Sessions** — Stateful conversation context

### Security Layers

```
┌─────────────────────────────────────────────┐
│ Client (Browser/PWA)                        │
│ └─ HTTPS, CSP, COOP/CORP isolation         │
├─────────────────────────────────────────────┤
│ Next.js API Routes                          │
│ └─ Zod validation, rate limiting           │
├─────────────────────────────────────────────┤
│ Supabase Edge Functions & RPC               │
│ └─ Trusted environment                      │
├─────────────────────────────────────────────┤
│ PostgreSQL with RLS Policies                │
│ └─ Row-level tenant isolation               │
└─────────────────────────────────────────────┘
```

---

## 📊 Performance Targets

| Metric | Target |
|--------|--------|
| **STT Latency** | <100ms (Deepgram) |
| **LLM Response** | <2s (Groq) |
| **API p99 Latency** | <500ms |
| **Concurrent Users** | 1000+ |
| **Data Retention** | Indefinite (Postgres backup ≥30d) |

---

## 🛠️ Developer Quick Start

### Prerequisites
- **Node.js** 18+
- **Docker** (for Supabase local development)
- **Git** (with Husky pre-push hooks)

### Installation

```bash
# Clone and install
git clone https://github.com/cronix/cronix.git
cd cronix
npm install

# Environment setup
cp .env.example .env.local
# Configure: SUPABASE_URL, ANON_KEY, SERVICE_KEY, GROQ_API_KEY, etc.

# Database migrations
npx supabase migration up

# Development server
npm run dev
# Open http://localhost:3000
```

### Testing

```bash
# Unit & integration tests (Vitest + Jsdom)
npm test

# E2E tests (Playwright)
npm run test:e2e

# Coverage report
npm run test:coverage

# Watch mode with UI
npm run test:ui
```

### Code Quality

```bash
# Type checking (strict mode enforced)
npm run typecheck

# ESLint + Prettier (auto-fix on staged files)
npm run lint

# Pre-push validation (automatic via Husky)
git push
# Fails if: lint errors, type errors, or tests fail
```

---

## 📁 Project Structure

```
cronix/
├── app/                              # Next.js App Router
│   ├── [locale]/                    # i18n dynamic segments
│   │   ├── login/                   # Auth (passkey, Google OAuth)
│   │   ├── register/                # Onboarding flow
│   │   ├── dashboard/               # Main application
│   │   │   └── settings/            # Tenant branding, preferences
│   │   ├── forgot-password/         # Recovery flow
│   │   ├── reset-password/          # Password reset
│   │   ├── terms/                   # Terms of service
│   │   └── privacy/                 # Privacy policy
│   └── api/
│       ├── assistant/               # Voice AI endpoint
│       ├── activity/                # Audit log API
│       ├── admin/                   # Admin operations
│       ├── health/                  # Health check
│       └── passkey/                 # WebAuthn ceremony
├── lib/
│   ├── ai/                          # AI orchestration
│   │   ├── assistant-service.ts    # Main Voice AI coordinator
│   │   ├── intent-router.ts        # NLU for request classification
│   │   ├── tool-definitions.ts     # LLM tool specifications
│   │   ├── circuit-breaker.ts      # Resilience patterns
│   │   ├── memory-service.ts       # Long-term context (RAG)
│   │   ├── output-shield.ts        # LLM response validation
│   │   ├── providers/              # STT/LLM/TTS implementations
│   │   └── tools/                  # Tool implementations
│   │       ├── appointment.tools.ts # Schedule, reschedule, cancel
│   │       ├── client.tools.ts     # Client lookup, create, update
│   │       ├── crm.tools.ts        # Client history, notes
│   │       └── finance.tools.ts    # Revenue, transactions
│   ├── auth/                        # Session & business context
│   ├── repositories/                # Data access layer
│   ├── rate-limit/                  # Token bucket + sliding window
│   ├── notifications/               # WhatsApp, email, push
│   ├── validations/                 # Zod input schemas
│   └── security/                    # RLS policies
├── components/
│   ├── ui/                          # Design system components
│   ├── dashboard/                   # Page-level components
│   └── hooks/                       # React hooks
├── supabase/
│   ├── migrations/                  # SQL schema versions (45+ migrations)
│   │   └── *_rls*.sql              # RLS policy updates
│   └── functions/                   # Edge Functions (Deno)
│       ├── cron-reminders/         # Scheduled appointment notifications
│       ├── process-whatsapp/       # WhatsApp message handling
│       └── push-notify/            # Web push dispatcher
├── __tests__/                       # Test suite
├── playwright/                      # E2E test specs
└── docs/                            # Architecture & guides
```

---

## 🚀 Deployment

### Hosting: Vercel (Global Edge Deployment)

**CI/CD Pipeline:**
1. Push to `develop` → Lint + Type Check + Tests
2. PR to `main` → Same checks + code review
3. Merge to `main` → Auto production deployment
4. Deploy to Vercel → Global rollout in 2-3 minutes

**Pre-push Hook (Husky):**
```bash
git push
# Validates: eslint, typecheck, tests
# Prevents broken code from reaching Git
```

---

## 🔍 Monitoring & Observability

### Error Tracking (Sentry)
- Source maps uploaded on build (never public)
- Errors grouped by function and context
- Real-time alerts on critical failures

### Structured Logging (Axiom)
- API requests: latency, user ID, business ID, status
- AI assistant calls: intent, tool usage, latency
- Database query slowness monitoring (>1s flagged)

### Health Checks
- `/api/health` — database, external APIs, Redis cache
- Monitored by Cronix uptime tracking

---

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| **[TECHNICAL_DOCUMENTATION_ES.md](docs/architecture/TECHNICAL_DOCUMENTATION_ES.md)** | Complete system design in Spanish (not in git) |
| **[API.md](docs/api/API.md)** | Endpoint reference |
| **[SECURITY.md](docs/security/SECURITY.md)** | Threat model, RLS policies |

---

## 🤝 Contributing

### Code Standards
- **No `any` types** — strict TypeScript required
- **No console logs** — use structured logging
- **Dev/prod parity** — all code must work in both
- **Clean architecture** — separation of concerns

### Before Pushing
```bash
npm run lint typecheck test
# All must pass before push
```

---

**Built with precision for modern service businesses.** ⚡
