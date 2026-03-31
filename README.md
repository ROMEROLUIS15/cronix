# ⚡ Cronix — AI-Powered SaaS for Business & Appointment Management

<p align="center">
  <strong>Multi-tenant platform for service businesses in Latin America.</strong><br>
  Manage appointments, clients, team, finances, and automated WhatsApp AI scheduling — all in a single PWA optimized for mobile.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js 14" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/AI-Llama%203.3%2070B-FF6B35?logo=meta&logoColor=white" alt="Llama 3.3" />
  <img src="https://img.shields.io/badge/Groq-LPU%20Inference-F55036?logo=groq&logoColor=white" alt="Groq" />
  <img src="https://img.shields.io/badge/WhatsApp-Cloud%20API-25D366?logo=whatsapp&logoColor=white" alt="WhatsApp" />
  <img src="https://img.shields.io/badge/Sentry-Monitoring-362D59?logo=sentry&logoColor=white" alt="Sentry" />
  <img src="https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=white" alt="Vercel" />
</p>

---

> **Intellectual Property:** This is a proprietary commercial project. The source code is exposed exclusively for technical portfolio purposes. Copying, distribution, or commercial use is strictly prohibited without prior authorization.

**🔗 Live at:** [https://cronix-app.vercel.app](https://cronix-app.vercel.app)

---

## Table of Contents

- [Why Cronix](#why-cronix)
- [Technical Highlights](#technical-highlights)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
  - [High-Level Overview](#high-level-overview)
  - [Project Structure](#project-structure)
- [AI Agent Architecture](#ai-agent-architecture)
  - [Structured In-Memory RAG](#structured-in-memory-rag)
  - [Action Tags vs JSON Function Calling](#action-tags-vs-json-function-calling)
  - [Silent Execution (Confirmación en Silencio)](#silent-execution-confirmación-en-silencio)
  - [Two-Turn Safety Flow](#two-turn-safety-flow)
  - [Voice Notes & Transcription](#voice-notes--transcription)
  - [AI Agent End-to-End Workflow](#ai-agent-end-to-end-workflow)
- [Security Architecture](#security-architecture)
  - [Authentication & Identity](#authentication--identity)
  - [3-Layer Anti-Spam Defense](#3-layer-anti-spam-defense)
  - [Multi-Tenant Data Isolation (RLS)](#multi-tenant-data-isolation-rls)
  - [Meta HMAC Signature Verification](#meta-hmac-signature-verification)
  - [PII Scrubbing in Sentry](#pii-scrubbing-in-sentry)
- [Notification System](#notification-system)
  - [Push Notifications (RFC 8291)](#push-notifications-rfc-8291)
  - [WhatsApp Reminders (pg_cron)](#whatsapp-reminders-pg_cron)
  - [Notification Flow Diagram](#notification-flow-diagram)
- [Features](#features)
  - [Appointment Management](#appointment-management)
  - [Client Management](#client-management)
  - [Team & Employees](#team--employees)
  - [Services Management](#services-management)
  - [Finances](#finances)
  - [Reports & Analytics](#reports--analytics)
  - [Business Settings](#business-settings)
  - [PWA & Offline Support](#pwa--offline-support)
  - [Contact Picker](#contact-picker)
- [Error Tracking & Monitoring (Sentry)](#error-tracking--monitoring-sentry)
- [Database Design](#database-design)
- [Performance Metrics](#performance-metrics)
- [LLM Provider Abstraction](#llm-provider-abstraction)
- [Setup & Configuration](#setup--configuration)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running Locally](#running-locally)
- [Deployment](#deployment)
- [Scalability & Future Roadmap](#scalability--future-roadmap)
- [Author](#author)
- [License](#license)

---

## Why Cronix

Service businesses in Latin America (barbershops, beauty salons, clinics, gyms) still manage appointments via paper, personal WhatsApp chats, or generic tools not designed for the region. Cronix solves this with:

- **A WhatsApp AI Agent** that books, reschedules, and cancels appointments in natural Spanish — including voice notes
- **A full business dashboard** (PWA) for managing clients, team, finances, and analytics
- **Multi-tenant architecture** where multiple businesses share infrastructure securely — each one fully isolated at the database level via PostgreSQL Row Level Security
- **Zero-password authentication** with Passkeys (Face ID / fingerprint) for frictionless mobile access

---

## Technical Highlights

| Area | Implementation |
|------|---------------|
| **AI Agent** | Conversational actuator using Groq + Llama-3.3-70B with Structured In-Memory RAG and Action Tag routing (see [AI Architecture](#ai-agent-architecture)) |
| **Security** | Passkeys (WebAuthn), Meta HMAC-SHA256, 3-layer anti-spam, PII scrubbing, PostgreSQL RLS with 26 pgTAP tests |
| **Voice Support** | Real-time voice note transcription via Groq Whisper (`whisper-large-v3-turbo`), converting spoken Spanish into scheduled appointments |
| **Push Notifications** | RFC 8291 Web Push (VAPID + AES-128-GCM) built from scratch with zero npm dependencies using Web Crypto API |
| **Event-Driven** | Supabase Database Webhooks decoupling data transactions from push notifications |
| **Serverless** | 4 Supabase Edge Functions (Deno) + pg_cron for timezone-aware daily reminders |
| **Error Monitoring** | Full-stack Sentry integration (Next.js client/server/edge + Deno Edge Functions) with multi-tenant tags and breadcrumbs |
| **LLM Observability** | Helicone Proxy Gateway tracking latency, token cost, threat monitoring, and prompts per tenant (`heliconeHeaders`) |
| **Zero-Latency Opt-in** | B2B WhatsApp verification interceptor (`VINCULAR-[slug]`) enabling real-time secure admin alerts without LLM overhead |
| **Offline-First** | PWA with custom Service Worker — installable on iOS, Android, and desktop |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, Server Components, Server Actions) |
| Language | TypeScript 5 — strict mode, zero `any` |
| Database | PostgreSQL via Supabase (RLS, ENUMs, optimized indexes, 17 versioned migrations) |
| Authentication | Supabase Auth + WebAuthn/Passkeys (biometrics) + Google OAuth |
| Data Access | Supabase JS SDK with typed repositories |
| Cache / Data Fetching | React Query v5 (`@tanstack/react-query`) with global cache |
| Styles | Tailwind CSS 3 + CVA (class-variance-authority) |
| Validation | Zod (shared schemas in client and server) |
| Forms | React Hook Form + Zod resolvers |
| Dates | date-fns v4 |
| Icons | Lucide React |
| Unit Testing | Vitest + jsdom |
| DB Testing | pgTAP (RLS tests against real Postgres) |
| Error Tracking | Sentry (Next.js Client/Server/Edge + Supabase Deno Functions) |
| WhatsApp | WhatsApp Cloud API v19.0 (Meta) — approved template |
| Web Push | RFC 8291 — VAPID + AES-128-GCM, native Service Worker |
| AI Observability | Helicone Proxy Gateway (Latency, Cost tracking, Threat monitoring per tenant) |
| AI Engine | Groq API + Llama-3.3-70b-versatile (In-Context Learning, Action Tag Routing) |
| Voice Transcription | Groq Whisper (`whisper-large-v3-turbo`) |
| Event Engine | Supabase Database Webhooks (pg_net) |
| Edge Functions | Supabase (Deno) — `whatsapp-webhook`, `whatsapp-service`, `push-notify`, `cron-reminders` |
| Scheduler | Supabase pg_cron — hourly trigger with per-timezone 8 PM targeting |
| PWA | next-pwa — installable on iOS, Android, desktop |
| Deploy | Vercel (auto-deploy from `main`) |

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CRONIX PLATFORM                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────────────┐  │
│  │  Next.js 14   │    │  Supabase     │    │  Edge Functions (Deno)   │  │
│  │  (Vercel)     │◄──►│  PostgreSQL   │◄──►│                          │  │
│  │               │    │  + Auth + RLS │    │  ├─ whatsapp-webhook     │  │
│  │  ├─ Dashboard │    │               │    │  ├─ whatsapp-service     │  │
│  │  ├─ Auth      │    │  17 Migrations│    │  ├─ push-notify          │  │
│  │  ├─ PWA/SW    │    │  26 pgTAP     │    │  └─ cron-reminders      │  │
│  │  └─ API       │    │  Tests        │    │                          │  │
│  └──────┬───────┘    └───────┬───────┘    └───────────┬──────────────┘  │
│         │                    │                        │                  │
│         ▼                    ▼                        ▼                  │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────────────┐  │
│  │  Sentry      │    │  pg_cron      │    │  External Services       │  │
│  │  (Monitoring)│    │  (Scheduler)  │    │                          │  │
│  │              │    │               │    │  ├─ Meta WhatsApp API    │  │
│  │  Full-stack  │    │  Hourly check │    │  ├─ Groq (LLM + Whisper)│  │
│  │  Multi-tenant│    │  → 8 PM local │    │  ├─ Google OAuth        │  │
│  │  PII scrub   │    │  per timezone │    │  └─ Web Push Services   │  │
│  └──────────────┘    └───────────────┘    └──────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
cronix/
├── app/                        # Next.js App Router
│   ├── api/                    # API Routes (Node.js — native bindings only)
│   │   ├── passkey/            #   WebAuthn register + authenticate
│   │   └── activity/ping/     #   Session heartbeat
│   ├── auth/                   # Auth pages
│   │   ├── callback/           #   OAuth callback (Google) + identity linking
│   │   └── ...                 #   login, register, forgot-password, reset-password
│   ├── dashboard/              # Protected pages (layout + subpages)
│   │   ├── appointments/       #   Appointments CRUD + calendar + resolution
│   │   ├── clients/            #   Clients CRUD + history + debts + contact picker
│   │   ├── finances/           #   Transactions (income) + expenses
│   │   ├── services/           #   Business services CRUD
│   │   ├── team/               #   Employee management (CRUD + assignment)
│   │   ├── reports/            #   Business analytics and insights
│   │   ├── profile/            #   User profile + passkey management
│   │   ├── settings/           #   Business config (hours, WhatsApp, notifications)
│   │   └── setup/              #   Onboarding wizard
│   ├── privacy/                # Privacy policy
│   ├── terms/                  # Terms of service
│   └── page.tsx                # Landing page
├── components/
│   ├── ui/                     # Reusable primitives (Modal, Card, Button, etc.)
│   ├── layout/                 # Sidebar, Topbar, DashboardShell, BottomNav
│   ├── dashboard/              # Dashboard-specific (calendar grid, day panel, etc.)
│   └── providers.tsx           # QueryClientProvider (React Query)
├── lib/
│   ├── supabase/               # Clients (browser, server, admin, middleware, tenant)
│   ├── repositories/           # Data access layer (typed, per table)
│   ├── use-cases/              # Business logic (validations, rules)
│   ├── services/               # External service wrappers
│   ├── validations/            # Zod schemas (auth, appointments, clients, etc.)
│   ├── hooks/                  # React hooks (business context, contact picker, etc.)
│   ├── actions/                # Server Actions
│   ├── auth/                   # Auth utilities (get-session, get-business-id)
│   ├── constants/              # App constants
│   └── utils/                  # General utilities
├── types/                      # Global TypeScript types
│   ├── database.types.ts       #   Supabase auto-generated types
│   ├── index.ts                #   Custom domain types
│   └── query-types.ts          #   Query-specific types
├── supabase/
│   ├── functions/              # Edge Functions (Deno)
│   │   ├── _shared/            #   Shared utilities (Sentry wrapper)
│   │   ├── whatsapp-webhook/   #   AI Agent + Meta Webhook (5 modules)
│   │   ├── whatsapp-service/   #   Template message sender
│   │   ├── push-notify/        #   Web Push (RFC 8291, zero npm deps)
│   │   └── cron-reminders/     #   Timezone-aware daily reminders
│   ├── migrations/             #   17 versioned SQL migrations
│   └── tests/                  #   pgTAP RLS tests (26 tests)
├── __tests__/                  # Unit tests (Vitest)
├── worker/                     # Custom Service Worker (merged by next-pwa)
├── public/                     # PWA manifest, icons, SW output
└── AI_ARCHITECTURE.md          # AI design decision document
```

---

## AI Agent Architecture

The WhatsApp AI Agent is the core differentiator of Cronix. It processes natural language (text and voice) from WhatsApp and executes real database transactions — booking, rescheduling, and canceling appointments — without the customer ever leaving their chat.

> 📖 For a deep dive into the architectural rationale, see [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md).

### Structured In-Memory RAG

The agent implements a **Structured In-Memory RAG (Retrieval-Augmented Generation)** pattern. Before each AI call, the webhook fetches tenant-specific context from PostgreSQL and injects it into the system prompt:

| Context Injected | Source |
|-----------------|--------|
| Business name, timezone, personality | `businesses` table |
| Working hours and custom AI rules | `businesses.settings` JSONB |
| Service catalog (names, prices, durations, IDs) | `services` table |
| Client status (new vs. recurring) | `clients` via `fn_find_client_by_phone` RPC |
| Active upcoming appointments | `appointments` table (pending/confirmed) |
| Last 4 conversation turns | `wa_audit_logs` table |

This ensures the AI **never hallucinates** services, prices, or schedules — every piece of information comes from the live database, scoped to the specific business.

### Action Tags vs JSON Function Calling

Instead of forcing the LLM to output structured JSON (OpenAI Function Calling), Cronix uses **Action Tags** — structured text commands embedded at the end of the AI's natural conversational response:

```
# AI generates this response:
"¡Perfecto! Tu cita de Corte de Cabello queda agendada para el martes 12 de abril a las 10:00 AM.
[CONFIRM_BOOKING: a1b2c3d4-e5f6-7890-abcd-ef1234567890, 2024-04-12, 10:00]"
```

The backend parses these tags with a deterministic regex in O(1) time:

```typescript
const CONFIRM_TAG_RE    = /\[CONFIRM_BOOKING:\s*([a-f0-9-]{36}),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/i
const RESCHEDULE_TAG_RE = /\[RESCHEDULE_BOOKING:\s*([a-f0-9-]{36}),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/i
const CANCEL_TAG_RE     = /\[CANCEL_BOOKING:\s*([a-f0-9-]{36})\]/i
```

**Why not JSON Function Calling?**

| Criteria | JSON Function Calling | Action Tags (Cronix) |
|----------|----------------------|---------------------|
| Parser failure mode | `JSON.parse()` crashes on malformed output → **server error** | Regex silently skips malformed tags → **graceful degradation** |
| Latency | Extra tokens for schema + JSON structure → **slower** | Minimal overhead → **ultra-fast** |
| Model compatibility | Requires fine-tuned models (GPT-4, etc.) | Works with any text-generation model |
| Debugging | Opaque JSON payloads in logs | Tags visible in natural conversation flow |
| Cost | More tokens = higher inference cost | Fewer tokens = lower cost |

### Silent Execution (Confirmación en Silencio)

The customer in WhatsApp **never sees** the technical Action Tags. The webhook implements a clean interception pattern:

```
AI Response (internal):  "¡Listo! Tu cita quedó agendada. [CONFIRM_BOOKING: ...]"
         ↓
   1. Parse tag → Execute DB mutation (create appointment)
   2. Strip tag → cleanResponse.replace(ALL_TAGS_RE, '')
   3. Send push notification to business owner
         ↓
WhatsApp Message (customer sees):  "¡Listo! Tu cita quedó agendada."
```

The full AI response (including tags) is preserved in `wa_audit_logs` for audit trail and observability.

### Two-Turn Safety Flow

To prevent hallucinated bookings, the system prompt enforces a **mandatory two-turn confirmation flow**:

```
Turn 1 (AI):     "Agendaré Corte de Cabello el martes a las 10:00 AM. ¿Es correcto?"  → NO TAG
Turn 2 (Client): "Sí"
Turn 3 (AI):     "¡Listo! Tu cita quedó agendada."  → [CONFIRM_BOOKING: ...]
```

The AI is explicitly prohibited from emitting a tag in the same message where it proposes an action. This structural constraint eliminates false positives.

### Voice Notes & Transcription

Cronix supports voice-based appointment scheduling via WhatsApp voice notes:

```
Voice Note → Meta CDN → Download Binary → Groq Whisper → Spanish Transcript → AI Agent → Action
```

| Component | Detail |
|-----------|--------|
| Model | `whisper-large-v3-turbo` |
| Provider | Groq API (same key as LLM) |
| Language | Spanish (`es`) — hardcoded for Latin American businesses |
| Cost | ~$0.001 per minute of audio |
| Latency | < 3 seconds end-to-end |

### AI Agent End-to-End Workflow

```
1.  User sends message/voice → WhatsApp
2.  Meta webhook → whatsapp-webhook Edge Function
3.  ✅ Verify Meta HMAC-SHA256 signature
4.  ✅ Extract #slug from message (business routing)
5.  ✅ Check message rate limit (10 msgs/60s per phone)
6.  ✅ Sanitize message (anti prompt-injection)
7.  📞 If voice note → Download from Meta CDN → Transcribe via Groq Whisper
8.  🏢 Resolve business (slug → session → landing)
9.  📊 Fetch RAG context in parallel (services, client, appointments, history)
10. 🤖 Call Groq API (Llama-3.3-70B) with system prompt + context
11. 🏷️ Parse Action Tags from AI response
12. 💾 Execute database mutations (create/reschedule/cancel via RPC)
13. 🔔 Send push notification to business owner (fire-and-forget)
14. ✉️ Strip tags → Send clean message to customer via WhatsApp
15. 📝 Log full interaction (including tags) to wa_audit_logs
```

---

## Security Architecture

### Authentication & Identity

| Method | Implementation |
|--------|---------------|
| Email/Password | Supabase Auth with email verification |
| Google OAuth | One-click login with automatic account merging |
| Passkeys (WebAuthn) | Face ID / fingerprint via `@simplewebauthn` v13 |
| Session Management | 30-min inactivity timeout, 12-hour absolute limit |
| Identity Linking | `enable_manual_linking = true` — email + Google merge automatically |
| Route Protection | Middleware protects `/dashboard/*`; blocked users auto-logged out |

### Zero-Latency Admin Verification (WhatsApp)

To comply with Meta Business Opt-In policies without incurring LLM processing delays, an **Inversion of Flow Interceptor** is used to validate business owners securely. The merchant clicks a deep link (`wa.me/?text=VINCULAR-[slug]`), entirely bypassing the core RAG LLM. The edge function:
1. Validates the unique cryptographic payload (`slug`) against the PostgreSQL tenant database.
2. Irrevocably pairs the legitimate WhatsApp remote sender number to the `business` record.
3. Automatically authenticates the owner to receive real-time automated AI booking alerts.

### 3-Layer Anti-Spam Defense

```
Layer 1: MESSAGE RATE LIMIT
├── 10 messages / 60 seconds per phone number
├── Atomic PostgreSQL function (fn_wa_check_rate_limit)
├── Fail-open on DB error (never blocks legitimate users)
└── Silent drop — no error message to spammer

Layer 2: MESSAGE SANITIZATION
├── 500 character limit
├── Strip injected Action Tags ([CONFIRM_BOOKING...])
├── Strip prompt injection patterns ("ignore previous instructions")
├── Strip HTML/XML tags
└── Normalize whitespace

Layer 3: BOOKING RATE LIMIT
├── 2 bookings / 24 hours per phone per business
├── Atomic PostgreSQL function (fn_wa_check_booking_limit)
├── User-friendly message when exceeded
└── Prevents calendar flooding
```

### Multi-Tenant Data Isolation (RLS)

Every database query is scoped to the authenticated user's `business_id` via PostgreSQL Row Level Security. This is enforced at the database level — not application level — meaning even a compromised server cannot read another tenant's data.

- **26 pgTAP tests** verify RLS policies against real PostgreSQL
- All tables enforce `business_id` isolation
- Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` with explicit `business_id` filtering

### Meta HMAC Signature Verification

Every incoming WhatsApp webhook is verified against Meta's `X-Hub-Signature-256` header using HMAC-SHA256 with the app secret. Unsigned or tampered requests are rejected with HTTP 401 before any processing occurs.

### PII Scrubbing in Sentry

The shared Sentry wrapper (`_shared/sentry.ts`) implements a `beforeSend` hook that scrubs:

- Phone numbers (`+573001234567` → `[PHONE]`)
- Meta tokens (`EAABj...` → `[META_TOKEN]`)
- Bearer tokens → `Bearer [TOKEN]`
- Secret environment variables → `[REDACTED]`
- Sensitive headers (Authorization, Cookie, HMAC signatures)

---

## Notification System

### Push Notifications (RFC 8291)

The `push-notify` Edge Function implements Web Push from scratch using the **Deno Web Crypto API** with zero npm dependencies:

| Component | Implementation |
|-----------|---------------|
| Encryption | ECDH P-256 key agreement → HKDF → AES-128-GCM (aesgcm content encoding) |
| Authentication | VAPID JWT signed with ES256 (ECDSA P-256 + SHA-256) |
| Key wrapping | Raw 32-byte P-256 keys wrapped in PKCS#8 DER envelope (RFC 5915/5958) |
| Expired cleanup | 410/404 responses trigger automatic subscription purge |

**Two auth paths:**
- **Browser → EF:** `Authorization: Bearer <JWT>` (user creates appointment in dashboard)
- **Server → EF:** `x-internal-secret: <CRON_SECRET>` (cron-reminders or Database Webhooks)

### WhatsApp Reminders (pg_cron)

The `cron-reminders` Edge Function runs **every hour** via pg_cron. For each business, it checks if the local time is 8:00 PM using `toLocaleString` with the business's IANA timezone:

```
pg_cron (hourly) → cron-reminders Edge Function
    ├── For each business WHERE localHour === 20:
    │   ├── Fetch tomorrow's appointments
    │   ├── Skip appointments with cancelled reminders
    │   ├── Send WhatsApp reminder to each client (via whatsapp-service EF)
    │   ├── Track sent/failed status in appointment_reminders table
    │   └── Send consolidated push notification to business owner
    │       └── "📋 4 citas para mañana — 10:00 Luis · Corte, 11:00 María · Color..."
    └── Return JSON summary { businesses_checked, wa_sent, push_sent }
```

### Notification Flow Diagram

```
┌─────────────────────────── TRIGGER EVENTS ──────────────────────────────┐
│                                                                          │
│  1. AI BOOKS APPOINTMENT (real-time)                                     │
│     whatsapp-webhook → createAppointment() → fire-and-forget push-notify │
│     → Owner gets: "¡Nueva Reserva! 📅 Luis · Corte — 2024-04-12 10:00"  │
│                                                                          │
│  2. DAILY REMINDER (8 PM local, per timezone)                            │
│     pg_cron → cron-reminders EF                                          │
│     → Client gets: WhatsApp template reminder for tomorrow's appointment │
│     → Owner gets: "📋 4 citas para mañana" (consolidated push)           │
│                                                                          │
│  3. DASHBOARD ACTIONS (manual)                                           │
│     Dashboard → push-notify EF (via JWT auth)                            │
│     → Owner gets push for confirmed/cancelled appointments               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### Appointment Management

- **Interactive Calendar:** Monthly grid + daily drill-down panel
- **Multi-Service Appointments:** Junction table `appointment_services` — select multiple services per appointment
- **Staff Assignment:** Assign specific employee to each appointment
- **Double Booking Validation:** Configurable per business (`allowed` / `warn` / `blocked`)
- **Status Flow:** `pending` → `confirmed` → `completed` | `cancelled` | `no_show`
- **Quick Resolution:** One-click buttons for expired appointments ("Attended" / "No-show")
- **WhatsApp AI Booking:** Auto-confirmed via Silent Execution — owner can cancel from dashboard

### Client Management

- **Full CRUD** with phone (international format + country flags), email, address, avatar, tags, notes
- **Contact Picker:** Native Contact Picker API integration — tap to auto-fill name and phone
- **Debt Tracking:** Real-time debt = sum of unpaid appointment costs
- **Payment Distribution:** Single payment distributed across multiple unpaid appointments
- **Appointment History:** All appointments linked to client with filters

### Team & Employees

- **Employee CRUD:** Name, email, phone, role (employee/owner), status (active/inactive)
- **Owner-Only Management:** `assertOwner()` in server actions
- **Staff Assignment:** Link employees to appointments for scheduling
- **Safe Delete:** Prevent deletion if employee has assigned appointments

### Services Management

- **Service CRUD:** Name, description, price, duration (minutes), category
- **Multi-Service Support:** Select multiple services for one appointment
- **Auto-Duration:** Longest service determines total appointment time
- **AI Integration:** WhatsApp AI suggests services based on business catalog

### Finances

- **Income Tracking:** Amount, date, description, payment method, linked client/appointment
- **Expense Tracking:** Amount, date, description, category (`supplies`, `rent`, `utilities`, `payroll`, `marketing`, `equipment`, `other`)
- **Payment Methods:** Cash, Card, Transfer, QR, Other
- **Automatic Debt Reduction:** Payments reduce client debt proportionally

### Reports & Analytics

- **Appointment Statistics:** Total by status, completion rate, no-show rate
- **Financial Overview:** Income, expenses, net profit/loss, average transaction value
- **Client Metrics:** Total clients, repeat rate, retention, outstanding debt
- **Date Filtering:** Custom date range for all reports

### Business Settings

- **Operating Hours:** Weekly schedule (Monday–Sunday), per-day toggle
- **WhatsApp Integration:** Auto-generated slug (`business-name-xxxxx`), shareable deep link, regenerate option
- **Notification Preferences:** Toggle WhatsApp reminders, email alerts, Web Push
- **AI Personality:** Custom AI behavior and rules per business

### PWA & Offline Support

- **Installable:** Chrome/Android native prompt, iOS manual instructions, desktop
- **Service Worker:** Custom merge with next-pwa for push notification handling
- **Offline-First:** Cached content works without internet
- **Native Feel:** Standalone display, custom splash screens, no browser chrome

### Contact Picker

- **Native API:** Android picker, iOS (limited), Windows
- **Auto-Matching:** Detect country dial code → auto-select country flag
- **Feature Detection:** Button only renders if browser supports the API
- **Fallback:** Manual phone entry when unavailable

---

## Error Tracking & Monitoring (Sentry)

Full-stack Sentry integration across all execution environments:

| Environment | Coverage |
|-------------|----------|
| **Next.js Client** | React error boundaries, component rendering errors |
| **Next.js Server** | Server Actions, API Routes, server components |
| **Next.js Edge** | Middleware errors |
| **Deno Edge Functions** | Custom `_shared/sentry.ts` wrapper with graceful fallback |

**Edge Function instrumentation:**
- `addBreadcrumb()` traces every step (HMAC verification → RAG fetch → AI call → tag parsing → DB mutation)
- `setSentryTag('business_id', id)` enables per-tenant error filtering
- `flushSentry()` called before every response (Deno workers can die before async tasks complete)
- Dynamic import with no-op fallback if `@sentry/deno` fails to load

---

## Database Design

17 versioned migrations in `supabase/migrations/`:

| Migration | Purpose |
|-----------|---------|
| `base_schema` | Core tables (businesses, users, clients, services, appointments, transactions, expenses) |
| `appointment_reminders` | Reminder tracking table with status lifecycle |
| `optimize_indexes` | Performance indexes for high-traffic queries |
| `unique_email_constraint` | UNIQUE(email) on users table |
| `unique_phone_per_business` | UNIQUE(business_id, phone) on clients |
| `notification_subscriptions` | Web Push subscription storage |
| `setup_pg_cron` | pg_cron configuration for hourly reminder trigger |
| `fix_rls_passkey_users` | RLS policies for passkey challenges |
| `professionalize_whatsapp_agent` | WhatsApp sessions, audit logs, booking RPC |
| `whatsapp_final_hardening` | Slug-based routing, session management |
| `fix_slots_timezone` | Timezone-aware available slots RPC |
| `multi_service_appointments` | Junction table for multi-service appointments |
| `performance_indexes_wa_sessions` | Indexes for WhatsApp sessions and audit logs |
| `wa_rate_limiting` | Atomic message rate limiter (`fn_wa_check_rate_limit`) |
| `wa_booking_rate_limit` | Atomic booking limiter (`fn_wa_check_booking_limit`) |
| `fn_find_client_by_phone` | Client lookup by cleaned phone digits |
| `wa_booking_auto_confirm` | Auto-confirmed bookings (Silent Execution pattern) |

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| WhatsApp message → AI response | < 2 seconds (Groq Llama latency ~1.2s, overhead ~0.8s) |
| Voice note → transcription | < 3 seconds (Groq Whisper) |
| Database RLS check | < 10ms per query |
| Rate limit check | < 1ms (atomic SQL) |
| Push notification delivery | < 500ms |
| Throughput | ~1,000 concurrent users per Vercel instance |

---

## LLM Provider Abstraction

To switch LLM providers (e.g., Groq → OpenAI → Anthropic), edit **2 constants** in a single file:

```typescript
// supabase/functions/whatsapp-webhook/ai-agent.ts (lines 27-28)
const LLM_MODEL   = 'gpt-4-turbo'                                    // ← change model
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions'     // ← change URL
```

The `LLM_API_KEY` environment variable works with any OpenAI-compatible provider (Groq, OpenAI, Anthropic, Together, etc.) — no code changes needed.

---

## Setup & Configuration

### Prerequisites

- **Node.js 18+**
- **PostgreSQL 14+** (or Supabase Cloud)
- **Deno 1.40+** (for Edge Functions)
- **Git**
- **npm** or **yarn**

### Installation

```bash
# Clone repository
git clone <repo-url>
cd cronix

# Install dependencies
npm install

# Install Supabase CLI
npm install -g supabase

# Install Deno (for Edge Functions local testing)
# Windows: https://deno.land
# macOS/Linux: curl -fsSL https://deno.land/x/install/install.sh | sh
```

### Environment Variables

Create `.env.local` in the project root:

```bash
# ── Supabase ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ── Site ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ── AI / LLM Provider ────────────────────────────────────────────────────
LLM_API_KEY=gsk_...            # Groq API key (or OpenAI sk_..., etc.)

# ── WhatsApp ──────────────────────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID=102048159999...
WHATSAPP_VERIFY_TOKEN=your-custom-token
WHATSAPP_APP_SECRET=abcd1234ef5678...
WHATSAPP_ACCESS_TOKEN=EAABj...

# ── Web Push ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEkxyz...
# Generate: npx web-push generate-vapid-keys

# ── Internal Auth ─────────────────────────────────────────────────────────
CRON_SECRET=your-internal-secret

# ── WebAuthn (Passkeys) ──────────────────────────────────────────────────
NEXT_PUBLIC_WEBAUTHN_ORIGIN=http://localhost:3000
NEXT_PUBLIC_WEBAUTHN_RP_ID=localhost

# ── Google OAuth ──────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=123456...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Also create `supabase/.env.local`:

```bash
GROQ_API_KEY=gsk_...    # Same as LLM_API_KEY
```

**Supabase Edge Functions secrets** (production):

```bash
supabase secrets set LLM_API_KEY=gsk_...
supabase secrets set WHATSAPP_VERIFY_TOKEN=your-token
supabase secrets set WHATSAPP_APP_SECRET=your-secret
supabase secrets set WHATSAPP_ACCESS_TOKEN=your-token
supabase secrets set CRON_SECRET=your-secret
supabase secrets set VAPID_PUBLIC_KEY=your-key
supabase secrets set VAPID_PRIVATE_KEY=your-key
supabase secrets set VAPID_SUBJECT=mailto:admin@cronix.app
supabase secrets set SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Database Setup

```bash
# Apply all migrations to remote Supabase
supabase db push

# Run RLS tests
supabase test db --file supabase/tests/rls.test.sql
```

**Database Webhooks** (Supabase Dashboard → Database → Webhooks):
- **Table:** `appointments` | **Event:** `INSERT` | **Target:** `push-notify` EF
- **Header:** `x-internal-secret: <CRON_SECRET>`

### Running Locally

```bash
# Development server (hot reload via Turbopack)
npm run dev
# → http://localhost:3000

# Edge Functions (local testing)
supabase functions serve
# → http://localhost:54321/functions/v1/whatsapp-webhook

# Unit tests
npm test

# Type checking
npm run typecheck

# Build for production
npm run build
```

---

## Deployment

**Production URL:** [https://cronix-app.vercel.app](https://cronix-app.vercel.app)

| Component | Platform | Trigger |
|-----------|----------|---------|
| Next.js App | Vercel | Push to `main` branch → auto-deploy |
| Edge Functions | Supabase | `supabase functions deploy <name>` |
| Database | Supabase | `supabase db push` |
| Secrets | Vercel + Supabase | Dashboard → Environment Variables / Secrets |

```bash
# Deploy Edge Functions
supabase functions deploy whatsapp-webhook
supabase functions deploy whatsapp-service
supabase functions deploy push-notify
supabase functions deploy cron-reminders

# Push migrations to production
supabase db push
```

---

## Scalability & Future Roadmap

| Area | Current State | Future |
|------|--------------|--------|
| Language | Spanish (hardcoded) | Dynamic language per business setting |
| LLM Provider | Groq + Llama-3.3-70B | Helicone proxy for latency monitoring + semantic caching |
| Voice | Spanish via Whisper | Dynamic language detection |
| Reminders | WhatsApp only | SMS and email channels |
| Analytics | Dashboard reports | CSV/PDF export |
| AI Observability | Sentry breadcrumbs | Helicone for per-tenant cost tracking and threat detection |
| Booking Conflicts | Basic overlap detection | Staff-aware time-slot collision with working hours validation |

---

## Author

**Luis C. — Full-Stack Developer**

This project demonstrates:
- Modern Next.js 14 architecture with Server Components and Server Actions
- PostgreSQL RLS multi-tenancy at database level (26 pgTAP tests)
- Real-time AI integration (Groq + Llama-3.3-70B) with a deliberate Action Tag architecture
- Comprehensive security (WebAuthn, HMAC, rate limiting, PII scrubbing)
- RFC 8291 Web Push implementation from scratch using Web Crypto API
- PWA & mobile-first UX
- Enterprise-grade error monitoring with Sentry across 4 execution environments

---

## License

Proprietary. All rights reserved.
