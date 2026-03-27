# Cronix — SaaS Platform for Business and Appointment Management

---

**Intellectual Property:** This is a proprietary commercial project. The source code is exposed exclusively for technical portfolio purposes. Copying, distribution, or commercial use is strictly prohibited without prior authorization. See [INTELLECTUAL_PROPERTY.md](./INTELLECTUAL_PROPERTY.md).

---

> Multi-tenant platform for service businesses in Latin America. Management of appointments, clients, team, finances, and automated WhatsApp reminders — all in a single PWA application optimized for mobile.

---

## Technical Highlights
- **Cutting-Edge Security:** Implementation of Passkeys (WebAuthn) eliminating password dependency.
- **Robust Data Architecture:** Intensive use of **PostgreSQL RLS** (Row Level Security) with 26 automated tests in **pgTAP**, guaranteeing real multi-tenancy at the database level.
- **AI-Powered Automation:** Integrated WhatsApp AI Agent using **Google Gemini 1.5 Flash** for natural language appointment scheduling with tool-calling capabilities.
- **Event-Driven Architecture:** Supabase Database Webhooks securely decoupling data transactions from push notifications.
- **Serverless Automation:** Scalable reminder system using **Supabase Edge Functions (Deno)** and **pg_cron**, integrated with Meta's WhatsApp Cloud API v19.0.
- **UX Offline-First:** PWA configured with custom Service Workers for a native mobile experience.

---

## Tech Stack


| Layer | Technology |
|------|-----------|
| Framework | Next.js 14 (App Router, Server Components, Server Actions) |
| Language | TypeScript 5 — strict typing throughout the project |
| Database | PostgreSQL via Supabase (RLS, ENUMs, optimized indexes) |
| Authentication | Supabase Auth + WebAuthn/Passkeys (biometrics) + Google OAuth |
| Data Access | Supabase JS SDK with typed repositories |
| Cache / Data Fetching | React Query v5 (`@tanstack/react-query`) with global cache |
| Styles | Tailwind CSS + CVA (class-variance-authority) |
| Validation | Zod (shared schemas in client and server) |
| Forms | React Hook Form + Zod resolvers |
| Dates | date-fns v4 |
| Icons | Lucide React |
| Unit Testing | Vitest + jsdom |
| DB Testing | pgTAP (RLS tests against real Postgres) |
| Notifications | WhatsApp Cloud API v19.0 (Meta) — approved template |
| Web Push | RFC 8291 — VAPID + AES-128-GCM, native Service Worker |
| AI Engine | Google Gemini 1.5 Flash (Multi-turn conversational loops & Tool Use) |
| Event Engine | Supabase Database Webhooks (pg_net) for decoupled notifications |
| Edge Functions | Supabase (Deno) — whatsapp-service, whatsapp-webhook, push-notify, cron-reminders |
| Scheduler | Supabase pg_cron — `cron-reminders` daily at 00:00 UTC |
| PWA | next-pwa — installable on iOS, Android, and desktop |
| Images | Sharp (PWA asset generation, optimization) |
| Deploy | Vercel (auto-deploy from `main`) |

---

## Architecture

cronix/
├── app/                    # Next.js App Router
│   ├── api/                # API Routes (Node.js — only what requires native bindings)
│   │   ├── passkey/        # WebAuthn register + authenticate (@simplewebauthn C++)
│   │   └── activity/ping/  # Session heartbeat
│   ├── auth/callback/      # OAuth callback (Google) + identity linking
│   ├── dashboard/          # Protected pages (layout + subpages)
│   │   ├── appointments/   # Appointments CRUD + resolution of expired ones
│   │   ├── clients/        # Clients CRUD + history + debts
│   │   ├── finances/       # Transactions and expenses
│   │   ├── services/       # Business services
│   │   ├── team/           # Employee management
│   │   ├── reports/        # Reports and analytics
│   │   ├── profile/        # Profile + passkeys
│   │   ├── settings/       # Configuration
│   │   └── setup/          # Onboarding wizard
│   ├── login/              # Login with email, Google, Passkeys
│   ├── register/           # Account registration
│   ├── forgot-password/    # Password recovery
│   └── reset-password/     # Password reset
├── components/
│   ├── ui/                 # Reusable primitives (Modal, Card, Avatar, etc.)
│   ├── layout/             # Sidebar, Topbar, DashboardShell, BottomNav
│   ├── dashboard/          # Dashboard-specific components
│   └── providers.tsx       # QueryClientProvider (React Query)
├── lib/
│   ├── supabase/           # Clients (browser, server, admin, middleware)
│   ├── repositories/       # Data access layer (by table)
│   ├── use-cases/          # Business logic (validations, rules)
│   ├── services/           # External services (WhatsApp)
│   ├── validations/        # Zod schemas
│   ├── hooks/              # React hooks (useBusinessContext, useFetch, usePwaInstall)
│   └── utils.ts            # General utilities
├── types/                  # Global TypeScript types + generated DB types
├── supabase/
│   ├── functions/          # Edge Functions (Deno)
│   │   ├── whatsapp-webhook/ # Gemini 1.5 AI Agent & Meta Webhook Verification
│   │   ├── whatsapp-service/ # WhatsApp message sending
│   │   ├── push-notify/    # Web Push RFC 8291 (Triggered organically by Database Webhooks)
│   │   └── cron-reminders/ # Reminder processing (called by pg_cron)
│   ├── migrations/         # Versioned SQL migrations
│   └── tests/              # pgTAP tests for RLS (26 tests)
├── worker/                 # Custom Service Worker (merged by next-pwa)
└── public/
    ├── manifest.json       # PWA manifest with splash screens
    ├── sw.js               # Compiled Service Worker
    ├── icon-192x192.png    # PWA icon (generated with Sharp)
    └── icon-512x512.png    # PWA icon (generated with Sharp)

---

## Features

### Authentication and Security

- **Login with email/password** and **OAuth with Google**
- **Passkeys / biometrics** — WebAuthn with `@simplewebauthn` v13. Fingerprint and Face ID on mobile and desktop without password
- **Identity linking** — if a user registers with email and later joins with Google (or vice-versa), accounts merge automatically. Duplicate accounts are never created thanks to:
  1. **Supabase:** `enable_manual_linking = true` merges auth users with same email
  2. **Application:** `register/actions.ts` verifies existing email with admin client before creating user
  3. **Database:** `UNIQUE(email)` constraint in `users` table
- **Smart callback** — `ensureUserProfile()` looks up by auth ID → by email → creates new, guaranteeing identity fusion
- **Email confirmation** enabled — users verify email before accessing
- **Session timeout** — 30 min inactivity + 12h absolute limit, enforced in middleware
- **Route protection** in Next.js middleware with fast-path: if no `sb-` cookies are present, the round-trip to Supabase Auth is skipped
- **Cached status check** — user status (`active`/`rejected`) is cached in a cookie for 5 minutes, eliminating DB queries on every dashboard navigation
- Blocked users (`status: rejected`) are automatically logged out
- **RLS on passkey_challenges** — protected table, only the user sees their own challenges

### Appointment Management

- Create, edit, and cancel appointments with service, client, and assigned employee selection
- **Interactive monthly calendar** with daily appointment view
- **Double booking validation** configurable by business: `allowed` / `warn` / `blocked`
- **Resolution of expired appointments** — "Yes, attended" / "No-show" buttons with responsive wrapping
- **Automated WhatsApp reminders** — when creating or editing an appointment, a reminder is scheduled with Meta's `appointment_reminder` template (4 variables: client name, business name, date, time)
- Statuses: `pending`, `confirmed`, `completed`, `cancelled`, `no_show`

### WhatsApp Reminders

- `appointment_reminders` table with statuses `pending → sent / failed / cancelled`
- **Supabase pg_cron** executes `cron-reminders` Edge Function daily at 00:00 UTC
- Edge Function `cron-reminders` processes the queue and calls `whatsapp-service` EF
- Integration with Meta's **WhatsApp Cloud API v19.0**
- **Permanent token** (Meta Business Manager System User Token, does not expire)
- Template with 4 variables: `{{1}}` client, `{{2}}` business, `{{3}}` date, `{{4}}` time
- Implicit retries: if it fails, the record remains in `failed` with the error message
- After sending WhatsApp, it triggers a Web Push to the business owner as confirmation

### WhatsApp AI Assistant (Gemini 1.5)

- **Automated Booking:** Clients can schedule appointments purely through natural conversation via WhatsApp.
- **Multi-turn Conversation:** The AI maintains context, checks real-time database availability, and responds naturally.
- **Strict Tool Calling:** Gemini utilizes `get_available_slots` and `create_appointment` natively through database RPC functions to guarantee RLS and data isolation.
- **Graceful Fallbacks:** The assistant securely handles Meta's HMAC SHA-256 signature verification, unmatched businesses, and unsupported requests.
- **Event-Driven Push Notifications:** Once the AI books an appointment, Postgres Database Webhooks automatically fire an asynchronous background job to notify the business owner via PWA Push Notifications without blocking the AI runtime.

### Client Management

- Full CRUD with contact details, notes, tags, and avatar photo
- Appointment history per client
- Debt management (`DebtActionDialog` dialog)

### Team / Employees

- Owners (`owner`) can create, edit, activate/deactivate, and delete employees
- Protected with `assertOwner()` in server actions — only the owner can manage the team
- Operations use `createAdminClient()` (service role) to bypass RLS, with explicit authorization validation at the server layer
- Anti-deletion protection: an employee with assigned appointments cannot be deleted

### Finances

- Recording of transactions and income
- Recording of expenses by categories (`supplies`, `rent`, `utilities`, `payroll`, `marketing`, `equipment`, `other`)
- Multiple payment methods: cash, card, transfer, QR, others.

---

## Setup & Configuration

### Edge Functions Secrets
For the AI Webhook and Notifier to operate securely, configure these secrets in your Supabase Production Dashboard (`npx supabase secrets set <NAME>=<VALUE>`):
- `GEMINI_API_KEY`: API Key for Google Gemini 1.5.
- `WHATSAPP_VERIFY_TOKEN`: Custom secret token to verify Webhook attachment to Meta.
- `WHATSAPP_APP_SECRET`: Meta App Secret used to compute SHA-256 integrity signatures on incoming requests.
- `CRON_SECRET`: Custom internal secret string for intra-service authentication.

### Event-Driven Push Notifications (Database Webhooks)
To guarantee strict Separation of Concerns (SoC) and atomic database transactions, Push Notifications are triggered directly by Postgres on row creation:
1. Go to **Supabase Dashboard -> Database -> Webhooks**.
2. Create a hook on the `appointments` table for **INSERT** events.
3. Target the `push-notify` Edge Function via **POST**.
4. Pass your `CRON_SECRET` through an HTTP Header named `x-internal-secret`. 

*This achieves 0-coupled logic: the Webhook simply inserts the rows, and Postgres handles notifying the business owner in the PWA.*
