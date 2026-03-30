# Cronix — SaaS Platform for Business and Appointment Management

---

**Intellectual Property:** This is a proprietary commercial project. The source code is exposed exclusively for technical portfolio purposes. Copying, distribution, or commercial use is strictly prohibited without prior authorization. See [INTELLECTUAL_PROPERTY.md](./INTELLECTUAL_PROPERTY.md).

---

> Multi-tenant platform for service businesses in Latin America. Management of appointments, clients, team, finances, and automated WhatsApp reminders — all in a single PWA application optimized for mobile.

**Live at:** https://cronix-app.vercel.app

---

## Table of Contents

- [Technical Highlights](#technical-highlights)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Features](#features)
  - [Authentication & Security](#authentication-and-security)
  - [Profile & Passkeys](#profile--passkeys)
  - [Appointment Management](#appointment-management)
  - [Client Management](#client-management)
  - [Team & Employees](#team--employees)
  - [Services Management](#services-management)
  - [Finances](#finances)
  - [Reports & Analytics](#reports--analytics)
  - [Business Settings](#business-settings)
  - [Error Tracking & Monitoring (Sentry)](#error-tracking--monitoring-sentry)
  - [WhatsApp Integration & AI Agent](#whatsapp-integration--ai-agent)
  - [Voice Notes & Transcription](#voice-notes--transcription)
  - [Push Notifications](#push-notifications)
  - [PWA & Offline Support](#pwa--offline-support)
  - [Contact Picker](#contact-picker)
  - [Voice Assistant](#voice-assistant)
- [Setup & Configuration](#setup--configuration)
- [Running Locally](#running-locally)
- [Deployment](#deployment)
- [Database Migrations](#database-migrations)
- [Performance Metrics](#performance-metrics)
- [Known Limitations](#known-limitations)

---

## Technical Highlights

- **Cutting-Edge Security:** Implementation of Passkeys (WebAuthn) eliminating password dependency. Biometric authentication via Face ID and fingerprint on mobile and desktop.
- **Robust Data Architecture:** Intensive use of **PostgreSQL RLS** (Row Level Security) with 26 automated tests in **pgTAP**, guaranteeing real multi-tenancy at the database level.
- **AI-Powered Automation (Ultra-Low Latency):** Integrated WhatsApp AI Agent using **Groq + Llama-3.3-70b-versatile** for natural language appointment scheduling. Powered by a highly optimized In-Context Learning engine and "Thinking" Scratchpad to guarantee zero hallucinations.
- **Advanced Scheduling Engine:** Native support for **multi-service appointments** and intelligent **staff/professional routing** directly from the AI or dashboard.
- **Event-Driven Architecture:** Supabase Database Webhooks securely decoupling data transactions from push notifications.
- **Serverless Automation:** Scalable reminder system using **Supabase Edge Functions (Deno)** and **pg_cron**, integrated with Meta's WhatsApp Cloud API v19.0.
- **Voice Support:** Real-time voice note transcription via Groq Whisper (`whisper-large-v3-turbo`), converting spoken Spanish into text for appointment booking.
- **3-Layer Anti-Spam Defense:** Message rate limiting (atomic PostgreSQL), message sanitization (anti prompt-injection), and booking rate limiting.
- **Enterprise Error Monitoring:** Full-stack Sentry integration (Next.js components, API routes, and Deno Edge Functions) with multi-tenant custom tags, breadcrumbs, and real-time alerts.
- **UX Offline-First:** PWA configured with custom Service Workers for a native mobile experience.
- **Contact Integration:** Native Contact Picker API for seamless phone number extraction.

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
| Error Tracking | Sentry (Next.js Client/Server/Edge + Supabase Deno Functions) |
| Notifications | WhatsApp Cloud API v19.0 (Meta) — approved template |
| Web Push | RFC 8291 — VAPID + AES-128-GCM, native Service Worker |
| AI Engine | Groq API + Llama-3.3-70b-versatile (In-Context Learning, Zero-Shot Routing) |
| Event Engine | Supabase Database Webhooks (pg_net) for decoupled notifications |
| Edge Functions | Supabase (Deno) — whatsapp-service, whatsapp-webhook, push-notify, cron-reminders |
| Scheduler | Supabase pg_cron — `cron-reminders` daily at 00:00 UTC |
| PWA | next-pwa — installable on iOS, Android, and desktop |
| Images | Sharp (PWA asset generation, optimization) |
| Deploy | Vercel (auto-deploy from `main`) |

---

## Architecture

```
cronix/
├── app/                    # Next.js App Router
│   ├── api/                # API Routes (Node.js — only what requires native bindings)
│   │   ├── passkey/        # WebAuthn register + authenticate (@simplewebauthn C++)
│   │   └── activity/ping/  # Session heartbeat
│   ├── auth/
│   │   ├── callback/       # OAuth callback (Google) + identity linking
│   │   └── ...             # login, register, forgot-password, reset-password
│   ├── dashboard/          # Protected pages (layout + subpages)
│   │   ├── appointments/   # Appointments CRUD + resolution of expired ones
│   │   ├── clients/        # Clients CRUD + history + debts + contact picker
│   │   ├── finances/       # Transactions (income) and expenses
│   │   ├── services/       # Business services CRUD
│   │   ├── team/           # Employee management (CRUD + assignment)
│   │   ├── reports/        # Reports and analytics
│   │   ├── profile/        # User profile + passkey registration
│   │   ├── settings/       # Business configuration (hours, WhatsApp slug, notifications)
│   │   └── setup/          # Onboarding wizard
│   ├── privacy/            # Privacy policy
│   ├── terms/              # Terms of service
│   └── page.tsx            # Landing page
├── components/
│   ├── ui/                 # Reusable primitives (Modal, Card, Button, etc.)
│   │   ├── passkey-register.tsx   # WebAuthn registration UI
│   │   ├── passkey-login-button.tsx # WebAuthn login button
│   │   ├── phone-input-flags.tsx  # Phone input with country selector
│   │   ├── client-select.tsx      # Client dropdown selector
│   │   └── ...
│   ├── layout/             # Sidebar, Topbar, DashboardShell, BottomNav
│   ├── dashboard/          # Dashboard-specific components
│   │   ├── appointment-detail-panel.tsx
│   │   ├── day-panel.tsx
│   │   ├── calendar-grid.tsx
│   │   └── ...
│   └── providers.tsx       # QueryClientProvider (React Query)
├── lib/
│   ├── supabase/           # Clients (browser, server, admin, middleware, tenant)
│   ├── repositories/       # Data access layer (by table: users, appointments, clients, etc.)
│   ├── use-cases/          # Business logic (validations, rules)
│   ├── services/           # External services
│   │   ├── contact-picker.service.ts   # Native Contact Picker API wrapper
│   │   ├── push-notify.service.ts      # Web Push helper
│   │   ├── whatsapp.service.ts         # WhatsApp service (sending, media)
│   │   └── ...
│   ├── validations/        # Zod schemas (auth, appointments, clients, finances, etc.)
│   ├── hooks/              # React hooks
│   │   ├── use-business-context.ts    # Global business context
│   │   ├── use-contact-picker.ts      # Contact Picker API hook
│   │   ├── use-notifications.ts       # Web Push subscription manager
│   │   ├── use-pwa-install.ts         # PWA installation detection
│   │   ├── use-fetch.ts               # Data fetching with caching
│   │   └── ...
│   ├── actions/            # Server Actions
│   │   ├── voice-assistant.ts         # Voice command parsing
│   │   └── ...
│   ├── auth/               # Auth utilities
│   │   ├── get-session.ts
│   │   ├── get-business-id.ts
│   │   └── ...
│   ├── constants/          # App constants
│   │   └── business.ts     # Business categories
│   ├── utils/              # General utilities
│   │   ├── appointment-services.ts
│   │   └── ...
│   └── logger.ts           # Logging utility
├── types/                  # Global TypeScript types
│   ├── database.types.ts   # Supabase auto-generated types
│   ├── index.ts            # Custom types
│   └── query-types.ts      # Query-specific types
├── supabase/
│   ├── functions/          # Edge Functions (Deno)
│   │   ├── whatsapp-webhook/       # Groq AI Agent + Meta Webhook
│   │   │   ├── index.ts            # Main webhook orchestrator
│   │   │   ├── ai-agent.ts         # AI conversation engine
│   │   │   ├── types.ts            # Type definitions
│   │   │   ├── whatsapp.ts         # WhatsApp integration
│   │   │   ├── database.ts         # Database layer
│   │   │   └── ...
│   │   ├── whatsapp-service/       # WhatsApp message sending
│   │   ├── push-notify/            # Web Push notifications (RFC 8291)
│   │   └── cron-reminders/         # Reminder processing (pg_cron trigger)
│   ├── migrations/         # Versioned SQL migrations (RLS, tables, indexes)
│   └── tests/              # pgTAP tests for RLS (26 tests)
├── __tests__/              # Unit tests (Vitest)
│   ├── repositories/
│   ├── use-cases/
│   ├── validations/
│   └── ...
├── worker/                 # Custom Service Worker (merged by next-pwa)
├── public/
│   ├── manifest.json       # PWA manifest with splash screens
│   ├── sw.js               # Compiled Service Worker
│   ├── icon-192x192.png    # PWA icon (responsive)
│   ├── icon-512x512.png    # PWA icon
│   └── ...
├── .env.local.example      # Environment template
├── tsconfig.json           # TypeScript config (strict mode)
├── next.config.js          # Next.js config (PWA, SWC, etc.)
├── package.json            # Dependencies
└── README.md               # This file
```

---

## Features

### Authentication and Security

#### Email/Password & OAuth

- **Email/Password Registration:** Full account creation with email verification
- **Google OAuth:** One-click login with automatic account merging
- **Session Management:**
  - 30-minute inactivity timeout
  - 12-hour absolute session limit
  - Fast-path in middleware: if no `sb-` cookies, skip auth roundtrip
  - Cached status check: user `active`/`rejected` status cached in cookie for 5 minutes

#### Passkeys / WebAuthn (Face ID & Fingerprint)

- **Zero-Password Authentication:** Register fingerprint or Face ID on mobile/desktop
- **Implementation:** `@simplewebauthn/browser` (v13) + `@simplewebauthn/server` (v13)
- **Biometric Options:**
  - **Face ID** (iOS Safari, Android Chrome)
  - **Fingerprint** (Android, Windows Hello)
  - **Fallback:** PIN / pattern if device doesn't support biometrics
- **Profile UI:** Users register/manage passkeys from **Profile → Seguridad**
- **Database:** Passkey challenges stored in RLS-protected `passkey_challenges` table

#### Identity Linking

If a user registers with email and later joins with Google (or vice-versa), accounts merge automatically:
1. **Supabase:** `enable_manual_linking = true` merges auth users with same email
2. **Application:** `register/actions.ts` verifies existing email with admin client before creating user
3. **Database:** `UNIQUE(email)` constraint in `users` table
4. **Smart callback:** `ensureUserProfile()` looks up by auth ID → by email → creates new

#### Route Protection

- **Middleware:** `/app/middleware.ts` protects `/dashboard/*` routes
- **Logout on Block:** Users with `status: rejected` are automatically logged out
- **Email Confirmation:** Required before accessing dashboard

---

### Profile & Passkeys

**URL:** `/dashboard/profile`

#### Profile Information

- **Personal Data:**
  - Full name
  - Email (with email change confirmation requirement)
  - Phone (with country flag selector)
  - Profile photo (upload, change, delete — JPG/PNG/WebP, max 2MB)
- **Avatar:** Auto-generated initials or uploaded photo

#### Security

- **Change Password:** Option to update password
- **Password Requirements:** Minimum 6 characters, confirmation required
- **Passkey Management:**
  - Register fingerprint / Face ID
  - Delete existing passkeys
  - Multiple passkeys per user supported

---

### Appointment Management

**URLs:** `/dashboard/appointments`, `/dashboard/appointments/[id]/edit`, `/dashboard/appointments/new`

#### CRUD Operations

- **Create Appointment:**
  - Select client (with contact picker integration)
  - Select service(s) — multi-service support (junction table)
  - Assign staff member
  - Set date and time
  - Add notes
- **Edit Appointment:**
  - Modify all fields
  - Change assigned staff
  - Update services
- **Cancel/Delete:**
  - Set status to `cancelled`
  - Record `cancelled_at` timestamp

#### Interactive Calendar

- **Monthly Calendar View:** Visual grid with daily appointments
- **Daily Panel:** Drill-down to specific date, see all appointments for that day
- **Quick Actions:** Resolution buttons for expired appointments ("Yes, attended" / "No-show")

#### Double Booking Validation

- **Configurable:** Per-business setting in `business_settings` JSON
- **Options:** `allowed` / `warn` / `blocked`
- **Behavior:** Prevent or warn when two appointments overlap

#### Multi-Service Appointments

- **Junction Table:** `appointment_services` links appointments to services
- **Pricing Calculation:** Total cost = sum of selected service prices
- **Duration:** Longest service duration determines appointment length

#### Appointment Statuses

- `pending` — Created but not yet confirmed (WhatsApp bookings start here)
- `confirmed` — Approved and scheduled
- `completed` — Attended and finished
- `cancelled` — Canceled by user/system
- `no_show` — User didn't attend

#### Reminders

- **Automated WhatsApp Reminder:** Scheduled when appointment created/edited
- **Meta Template:** Approved `appointment_reminder` template with 4 variables:
  - `{{1}}` — Client name
  - `{{2}}` — Business name
  - `{{3}}` — Date (YYYY-MM-DD)
  - `{{4}}` — Time (HH:mm)
- **Database:** Tracked in `appointment_reminders` table with statuses: `pending → sent / failed / cancelled`
- **Scheduler:** Supabase `pg_cron` executes `cron-reminders` Edge Function daily at 00:00 UTC
- **Retry:** Implicit retries; failures remain in DB with error message

#### WhatsApp Booking Integration

- **Pending Approval:** All WhatsApp AI bookings arrive as `status='pending'` with `notes='Agendado vía WhatsApp AI'`
- **Dashboard Approval Bar:** Green approval bar in appointments list shows pending WhatsApp bookings
- **Confirm/Reject Buttons:** Business owner explicitly approves or rejects each booking
- **Approval Workflow:** Provides human control over AI bookings

---

### Client Management

**URLs:** `/dashboard/clients`, `/dashboard/clients/new`, `/dashboard/clients/[id]`, `/dashboard/clients/[id]/edit`

#### CRUD Operations

- **Create Client:**
  - Name, phone (with country selector)
  - Email, address
  - Avatar photo
  - Tags, notes
  - **Contact Picker:** Native integration — tap "Pick Contact" to auto-fill name & phone
- **Edit Client:** Modify all fields
- **Delete:** Mark as deleted (soft delete)

#### Client Profile

- **Appointment History:** All appointments linked to client with filters
- **Debt Calculation:** Real-time debt = sum of unpaid appointment costs
- **Debt Management:** Record payments with automatic distribution across unpaid appointments
- **Transaction Links:** Each payment can be tied to specific appointments

#### Contact Picker Integration

- **Native Contact Picker API:** Supported on Android, iOS (some versions), Windows
- **Auto-Matching:** Detects country dial code and auto-selects correct country flag
- **Fallback:** Manual phone entry if Contact Picker unavailable
- **Feature Detection:** Button only shows if browser supports the API

#### Contact Information

- **Phone:** International format with country flag
- **Email:** For notifications
- **Address:** For appointment location context
- **Avatar:** Optional client photo

---

### Team & Employees

**URL:** `/dashboard/team`

#### Employee Management

- **Create Employee:**
  - Name, email, phone
  - Role (employee, owner)
  - Status (active, inactive)
- **Edit Employee:** Update name, email, phone, status
- **Delete:** Only if no assigned appointments
- **Activation/Deactivation:** Toggle active status

#### Authorization

- **Owner Only:** `assertOwner()` in server actions — only business owner can manage team
- **Admin Client:** Uses `createAdminClient()` to bypass RLS with explicit validation

#### Staff Assignment

- **Appointments:** Assign specific employee to each appointment
- **Multi-Staff:** Different employees can handle different services in same appointment
- **Calendar:** Staff member can see assigned appointments

---

### Services Management

**URL:** `/dashboard/services`

#### CRUD Operations

- **Create Service:**
  - Service name, description
  - Price, duration (in minutes)
  - Category (optional)
- **Edit Service:** Update name, price, duration, category
- **Delete Service:** Mark as deleted

#### Service Usage

- **Multi-Service Appointments:** Select multiple services for one appointment
- **Auto-Duration:** Longest service determines total appointment time
- **Pricing:** Each service has independent price; total = sum of selected
- **AI Recommendations:** WhatsApp AI suggests services based on business catalog

---

### Finances

**URLs:** `/dashboard/finances`, `/dashboard/finances/transactions`, `/dashboard/finances/expenses`

#### Transactions (Income)

- **Record Income:**
  - Amount, date, description
  - Payment method (cash, card, transfer, QR, other)
  - Link to client (optional)
  - Link to appointment (optional)
- **Payment Distribution:** Single payment can be distributed across multiple appointments automatically
- **Debt Reduction:** Payment reduces client debt proportionally

#### Expenses

- **Record Expense:**
  - Amount, date, description
  - Category: `supplies`, `rent`, `utilities`, `payroll`, `marketing`, `equipment`, `other`
  - Payment method
- **Categorization:** Expenses grouped by category for reporting

#### Payment Methods

- Cash
- Card
- Transfer (bank transfer)
- QR (mobile payment)
- Other

#### Financial Reports

- **Summary Dashboard:** Overview of income vs. expenses
- **Period Reports:** Filter by date range
- **Category Breakdown:** Expense analysis by category

---

### Reports & Analytics

**URL:** `/dashboard/reports`

#### Business Insights

- **Appointment Statistics:**
  - Total appointments (by status)
  - Completion rate
  - No-show rate
  - Upcoming appointments
- **Financial Overview:**
  - Total income (by period)
  - Total expenses (by category)
  - Net profit/loss
  - Average transaction value
- **Client Metrics:**
  - Total clients
  - Repeat clients
  - Client retention rate
  - Outstanding debt

#### Date Filtering

- Filter reports by custom date range
- Export or view in dashboard

---

### Business Settings

**URL:** `/dashboard/settings`

#### Business Profile

- **Name & Category:** Business name, category (salon, clinic, gym, etc.)
- **Phone & Address:** Contact details
- **Logo/Icon:** Displayed in reminders and notifications

#### Operating Hours

- **Weekly Schedule:** Configure hours for each day (Monday–Sunday)
- **Time Format:** HH:mm (24-hour)
- **Active Days:** Toggle which days business is open
- **Default:** 9:00 AM – 6:00 PM Mon–Fri (configurable)

#### WhatsApp Integration

- **Shared Phone Number:** Single number (`+584147531158`) for all businesses
- **Business Slug:** Auto-generated unique identifier
  - Format: `business-name-xxxxx` (name + 6-char random suffix)
  - User can regenerate slug from settings
- **WhatsApp Link:** Pre-built deep link for sharing
  - Format: `https://wa.me/+584147531158?text=%23business-slug`
  - Copy button to clipboard
- **AI Agent:** Handles bookings via WhatsApp with slug-based routing

#### Notification Preferences

- **WhatsApp Reminders:** Toggle automated appointment reminders
- **Email Notifications:** Toggle email alerts (for future use)
- **Web Push Notifications:** Subscribe/unsubscribe from push notifications
  - Permission prompt on first toggle
  - Shows subscription status
  - Multi-device support

#### RLS Policies

- Business settings only visible to owner and team members with RLS
- Only owner can edit settings

---

### Error Tracking & Monitoring (Sentry)

**Global Setup:** Full-stack Sentry initialization across all Next.js environments (`client`, `server`, and `edge`) and Supabase Deno Edge Functions.

#### Next.js Integration

- **Global Error Boundaries:** `app/global-error.tsx` catches and reports unhandled React rendering errors.
- **Server Actions & API Routes:** Automatically traces requests, captures unhandled exceptions, and monitors backend performance.
- **Source Maps:** Automated release tagging and source map uploading via `@sentry/nextjs`.

#### Supabase Edge Functions (Deno)

- **Custom Wrapper:** `supabase/functions/_shared/sentry.ts` manages Deno edge environment limitations.
- **Breadcrumbs:** Strategic placement (`addBreadcrumb`) throughout AI pipelines to track prompt-injection blocks, LLM responses, rate limiting events, and payload sanitization logic.
- **Context & Tags:** Cross-references errors with specific businesses using `setSentryTag('business_id', id)` to isolate tenant-specific issues without exposing PII.
- **Graceful Flushing:** Ensures `flushSentry()` runs securely before closing worker processes given Supabase Edge's fire-and-forget limitations, avoiding lost reports during cold starts or crashes.

---

### WhatsApp Integration & AI Agent

**URLs (Edge Functions):**
- `/whatsapp-webhook` — Receives Meta webhooks
- `/whatsapp-service` — Sends messages
- `/cron-reminders` — Scheduled reminders

#### Reminders (pg_cron)

- **Trigger:** Daily at 00:00 UTC via `pg_cron`
- **Queue:** `appointment_reminders` table with status `pending`
- **Execution:** `cron-reminders` Edge Function processes queue
- **Sending:** Calls `whatsapp-service` EF for each reminder
- **Status Update:** Sets status to `sent` or `failed`
- **Template:** Meta's `appointment_reminder` with 4 variables

#### AI Agent (Groq + Llama 3.3)

**Model:** `llama-3.3-70b-versatile` via Groq API (LPU architecture for ultra-low latency)

**Capabilities:**
- **Text Messages:** Type appointment requests naturally
- **Voice Notes:** Transcribe Spanish voice → process normally
- **Multi-Service Cart:** Request and schedule multiple services in one interaction
- **Staff Routing:** Infers if business is solo or multi-staff, asks for preference
- **Intelligent Context:** Injects real-time business state (hours, services, availability) to prevent hallucinations

**Workflow:**
1. User sends message/voice to single shared WhatsApp number
2. Meta webhook calls `whatsapp-webhook` Edge Function
3. Webhook validates signature, extracts slug from message
4. Routes to correct business, fetches business context
5. Transcribes voice if audio (Groq Whisper)
6. Sanitizes message (anti-injection)
7. Calls Groq AI with system prompt
8. AI responds or emits action tags
9. Parser executes tags (CONFIRM_BOOKING, RESCHEDULE, CANCEL)
10. Database commits via RPC
11. Push notification sent to owner
12. User receives confirmation message

#### Action Tags

**CONFIRM_BOOKING:**
```
[CONFIRM_BOOKING: service_id, YYYY-MM-DD, HH:mm]
```
- Parses service, date, time from tag
- Checks booking rate limit (2 per 24h per sender)
- Creates appointment as `status='pending'` (requires owner approval)
- Confirms to user: "Solicitud recibida! Tu cita está pendiente de confirmación..."
- Notifies owner: "Nueva solicitud de cita vía WhatsApp"

**RESCHEDULE_BOOKING:**
```
[RESCHEDULE_BOOKING: appointment_id, YYYY-MM-DD, HH:mm]
```
- Updates existing appointment
- Recalculates duration
- Cancels old reminder, creates new

**CANCEL_BOOKING:**
```
[CANCEL_BOOKING: appointment_id]
```
- Sets status to `cancelled`, records `cancelled_at`
- Deletes pending reminder
- Confirms to user

#### Graceful Degradation (429 Rate Limit)

When Groq responds with HTTP 429 (rate limit exceeded):
- **Detection:** Check `res.status === 429`, extract `retry-after` header
- **Error Class:** `LlmRateLimitError` thrown with retry seconds
- **User Message:** "Estoy atendiendo muchas consultas. Intenta de nuevo en X minutos."
- **Logging:** Recorded as `LLM_RATE_LIMITED` (not a crash)
- **No Blocking:** Webhook returns quickly; doesn't block on retry

#### 3-Layer Anti-Spam Defense

See [TECHNICAL_DOCUMENTATION.md](#security--anti-spam-architecture) for deep dive

**Summary:**
- **Layer 1:** Message rate limiting (10 msgs/60s) — atomic PostgreSQL
- **Layer 2:** Message sanitization (500 char limit, tag stripping) — prevents injection
- **Layer 3:** Booking rate limiting (2 bookings/24h) — prevents calendar spam
- **Plan B:** Pending approval workflow — human safeguard

---

### Voice Notes & Transcription

**File:** `lib/actions/voice-assistant.ts`

#### Audio Processing Flow

1. **Voice Note Sent:** User records voice message in WhatsApp
2. **Meta Webhook:** Receives `msg.audio.id` (Meta CDN reference)
3. **Download:** `downloadMediaBuffer()` resolves CDN URL via Meta API, downloads binary
4. **Transcription:** `transcribeAudio()` sends buffer to Groq Whisper API
5. **Response:** Receives plain Spanish transcript
6. **Processing:** Transcript flows into AI agent as if typed
7. **Normal Flow:** Booking, rescheduling, cancellation proceeds normally

#### Groq Whisper Configuration

- **Model:** `whisper-large-v3-turbo`
- **API URL:** `https://api.groq.com/openai/v1/audio/transcriptions`
- **Language:** `es` (Spanish) — hardcoded for Latin American businesses
- **Response Format:** `text` (returns plain transcript, not JSON)
- **Auth:** Same `LLM_API_KEY` as chat completions
- **Cost:** ~0.1¢ per minute of audio

#### Error Handling

- **Download Fails:** Log error, ignore voice (no response sent)
- **Transcription 429:** Re-throw `LlmRateLimitError` (user gets "try again" message)
- **Transcription Other Error:** Fall back to "non-text ignored"
- **No Silent Failures:** All errors logged to `wa_audit_logs`

---

### Push Notifications

**URL:** `/dashboard/settings` (subscription toggle), Edge Function: `/push-notify`

#### Web Push (RFC 8291)

- **Standard:** RFC 8291 with VAPID + AES-128-GCM encryption
- **Setup:** Requires `NEXT_PUBLIC_VAPID_PUBLIC_KEY` environment variable
- **Generation:** `npx web-push generate-vapid-keys`

#### Subscription Lifecycle

**In Hook (`useNotifications`):**
1. **Feature Detection:** Check Push API, Notification API, ServiceWorker support
2. **Permission Request:** Ask browser for notification permission
3. **SW Registration:** Wait for Service Worker to be ready (8s timeout)
4. **PushManager.subscribe():** Subscribe with VAPID public key
5. **Persistence:** Save subscription (endpoint, p256dh, auth keys) to `notification_subscriptions` table
6. **Upsert:** Handle browser refresh (same endpoint, different keys)

**Unsubscription:**
1. Get active subscription from PushManager
2. Call `unsubscribe()` on subscription
3. Delete row from `notification_subscriptions` table

#### Multi-Tenant Safety

- Subscription scoped to `user_id` + `business_id`
- Unsubscribing removes DB row
- Only owner receives push notifications for their business

#### Trigger Events

- **Appointment Booked:** When AI creates appointment (WhatsApp)
- **Appointment Reminder:** Daily at scheduled time
- **Appointment Confirmed:** When owner approves WhatsApp booking
- **Custom:** Via `notifyOwner()` function in server actions

#### Database Webhooks Integration

1. Insert into `appointments` → PostgreSQL triggers Database Webhook
2. Webhook calls `push-notify` Edge Function
3. Edge Function resolves `business_id` from JWT
4. Queries `notification_subscriptions` for all devices of that user
5. Encrypts message with VAPID + AES-128-GCM
6. Sends to each endpoint via Web Push service
7. **Fire-and-Forget:** Failures logged but never block the original transaction

---

### PWA & Offline Support

**Setup:** `next-pwa` v5.6.0 configured in `next.config.js`

#### Installation

- **Chrome/Android:** Native `beforeinstallprompt` dialog
- **iOS Safari:** No native dialog; show manual "Add to Home Screen" instructions
- **Desktop:** Install button for Windows/Mac/Linux

#### Manifest

- **File:** `public/manifest.json`
- **Icons:** 192x192, 512x512 (generated with Sharp)
- **Colors:** Dark theme with Cronix blue (#0062FF)
- **Start URL:** `/dashboard`
- **Display:** `standalone` (native app feel)
- **Splash Screens:** Generated for iOS

#### Service Worker

- **Location:** `worker/` directory
- **Merge:** `next-pwa` auto-merges custom Service Worker with default
- **Caching Strategy:** Automatic for static assets
- **Offline Fallback:** Graceful error page if offline
- **Push Handler:** Receives Web Push events, displays notifications

#### Features

- **Offline-First:** Works without internet (cached content)
- **Quick Load:** Instant startup from home screen (no browser chrome)
- **Background Sync:** Service Worker queues failed requests
- **Native Feel:** Fullscreen, no address bar, custom splash screen

---

### Contact Picker

**Hook:** `useContactPicker()` in `lib/hooks/use-contact-picker.ts`
**Usage:** Client creation/edit forms

#### Native Contact Picker API

- **Browser Support:** Android native picker, iOS (limited), Windows
- **Fallback:** Manual phone entry if unsupported
- **Feature Detection:** Button only shows if supported

#### Auto-Matching Logic

1. **Extraction:** Get contact name and phone from native picker
2. **Dial Code Detection:** Match phone number to country by longest dial prefix
3. **Normalization:** Strip formatting (hyphens, parentheses, spaces) from local part
4. **Result:** Return `{ name, phoneLocal, country }` ready to populate form

#### Integration

- **Add Client Form:** "Pick Contact" button uses native picker
- **Auto-Fill:** Populates name and phone fields
- **Manual Override:** User can edit extracted data
- **No Permissions:** Uses native Contact Picker (user approves per request)

---

### Voice Assistant

**File:** `lib/actions/voice-assistant.ts`

#### Dashboard Voice Commands

- **Text Transcription:** Convert spoken text to written commands
- **Command Parsing:** Extract intent (create appointment, etc.)
- **Voice Input:** Optional voice button in dashboard for hands-free control

#### LLM Provider Configuration

- **Model:** Configurable via `LLM_API_URL` and `LLM_MODEL` constants
- **Auth:** Uses same `LLM_API_KEY` as WhatsApp AI
- **Fallback:** Graceful degradation if API unavailable

---

## Setup & Configuration

For detailed technical implementation of security, WhatsApp integration, voice processing, and database design, see **[TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md)**.

### Prerequisites

- **Node.js 18+**
- **PostgreSQL 14+** (or Supabase Cloud)
- **Deno 1.40+** (for Edge Functions testing)
- **Git**
- **npm** or **yarn**

### Installation

```bash
# Clone repository
git clone <repo-url>
cd cronix

# Install dependencies
npm install

# Install Supabase CLI (for migrations & Edge Functions)
npm install -g supabase

# Install Deno (for Edge Functions testing)
curl -fsSL https://deno.land/x/install/install.sh | sh  # macOS/Linux
# or download from https://deno.land (Windows)
```

### Environment Variables

#### `.env.local` (Application)

```bash
# ── Supabase ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # Public key from Supabase dashboard

SUPABASE_SERVICE_ROLE_KEY=eyJ...      # Service role (keep secret!)

# ── Site Configuration ────────────────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=https://cronix-app.vercel.app
# For local development:
# NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ── LLM / AI Provider (Groq or OpenAI-compatible) ─────────────────────────
LLM_API_KEY=gsk_...  # Groq API key
# For OpenAI: sk_...
# For Anthropic: sk-ant-...

# If using non-Groq provider, also configure in:
#   - supabase/functions/whatsapp-webhook/ai-agent.ts (lines 28–29)
#   - lib/actions/voice-assistant.ts (lines 14–15)

# ── WhatsApp Integration ──────────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID=102048159999...  # From Meta Business Manager
WHATSAPP_VERIFY_TOKEN=yourCustomTokenHere  # Custom secret (any string)
WHATSAPP_APP_SECRET=abcd1234ef5678...     # From Meta App Settings
WHATSAPP_ACCESS_TOKEN=EAABj...             # Permanent access token

# ── Web Push Notifications (RFC 8291) ─────────────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BEkxyz...  # Public VAPID key (base64url)
# Generate with: npx web-push generate-vapid-keys
# Keep VAPID_PRIVATE_KEY secure (only in Supabase Edge Functions secret)

# ── Cron Jobs / Internal Secrets ──────────────────────────────────────────
CRON_SECRET=your-internal-secret-for-cron  # For intra-service auth

# ── WebAuthn (Passkeys) ───────────────────────────────────────────────────
NEXT_PUBLIC_WEBAUTHN_ORIGIN=https://cronix-app.vercel.app
# For local: http://localhost:3000

NEXT_PUBLIC_WEBAUTHN_RP_ID=cronix-app.vercel.app
# For local: localhost

# ── Google OAuth ──────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=123456...apps.googleusercontent.com     # From Google Cloud Console
GOOGLE_CLIENT_SECRET=GOCSPX-...                           # Keep secret!
```

#### `supabase/.env.local` (Edge Functions)

```bash
# Same as above, plus:
GROQ_API_KEY=gsk_...  # Same as LLM_API_KEY if using Groq
```

### Supabase Edge Functions Secrets

Set these in **Supabase Dashboard → Edge Functions → Secrets**:

```bash
supabase secrets set LLM_API_KEY=gsk_...
supabase secrets set WHATSAPP_VERIFY_TOKEN=yourToken
supabase secrets set WHATSAPP_APP_SECRET=abcd1234ef5678
supabase secrets set CRON_SECRET=your-internal-secret
```

### Database Webhooks Configuration

For **Push Notifications** to work, configure Database Webhooks:

1. Go to **Supabase Dashboard → Database → Webhooks**
2. Create new webhook:
   - **Table:** `appointments`
   - **Events:** `INSERT`
   - **Target:** `push-notify` Edge Function (POST)
   - **Headers:** Add `x-internal-secret: <CRON_SECRET>`
3. Webhook fires automatically when appointments are created
4. `push-notify` Edge Function notifies business owner

---

## Running Locally

### Prerequisites

- **Node.js 18+**
- **PostgreSQL 14+** (or Supabase local development via `supabase` CLI)
- **Deno 1.40+** (for Edge Functions testing)
- **Git**

### Installation

```bash
# Clone repository
git clone <repo-url>
cd cronix

# Install dependencies
npm install

# Install Supabase CLI (for migrations & Edge Functions)
npm install -g supabase

# Install Deno (for Edge Functions)
curl -fsSL https://deno.land/x/install/install.sh | sh
```

### Environment Setup

Create `.env.local` in the project root:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# AI/LLM Provider
LLM_API_KEY=your-groq-api-key
# Configure LLM_API_URL and LLM_MODEL in:
#   - supabase/functions/whatsapp-webhook/ai-agent.ts (lines 28–29)
#   - lib/actions/voice-assistant.ts (lines 14–15)

# WhatsApp Integration
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_VERIFY_TOKEN=your-webhook-verify-token
WHATSAPP_APP_SECRET=your-app-secret
WHATSAPP_ACCESS_TOKEN=your-permanent-access-token

# Cron Jobs
CRON_SECRET=your-internal-secret-for-cron

# WebAuthn (Passkeys)
NEXT_PUBLIC_WEBAUTHN_ORIGIN=http://localhost:3000
NEXT_PUBLIC_WEBAUTHN_RP_ID=localhost

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Also create `supabase/.env.local` for Edge Functions:

```bash
# Same as above, plus:
GROQ_API_KEY=same-as-LLM_API_KEY
```

### Database Setup

```bash
# Start Supabase local development
supabase start

# Apply migrations
supabase db push

# Run tests (pgTAP)
supabase test db --file supabase/tests/rls.test.sql
```

### Running the Application

```bash
# Development server (hot reload)
npm run dev

# Opens http://localhost:3000

# Build for production
npm run build

# Test production build locally
npm run start
```

### Edge Functions (Local Testing)

```bash
# Serve Edge Functions locally (requires Deno)
supabase functions serve

# Webhook will be available at: http://localhost:54321/functions/v1/whatsapp-webhook
```

---

## Deployment

### Production Deployment (Vercel)

The application is deployed at: **https://cronix-app.vercel.app**

**Deployment flow:**
- Push to `main` branch → GitHub Actions triggers Vercel build
- Vercel auto-deploys to production
- Edge Functions deployed to Supabase (via `supabase/functions/` directory)

**Secrets in Vercel:**
- All `.env.local` variables must be added to Vercel dashboard under **Settings → Environment Variables**
- Use the same names as `.env.local`

### Database Migrations in Production

```bash
# Push migrations to production Supabase
supabase db push --linked

# List applied migrations
supabase migration list --linked
```

### Monitoring

- **Supabase Dashboard:** View logs, RLS policies, Edge Function executions
- **Vercel Dashboard:** View deployment logs, function usage
- **wa_audit_logs table:** Query directly in Supabase for WhatsApp interactions

---

## Database Migrations (Latest)

All migrations are versioned in `supabase/migrations/`. Key recent migrations:

| File | Purpose |
|------|---------|
| `20260329000000_performance_indexes_wa_sessions.sql` | RLS + indexes for WhatsApp sessions & audit logs |
| `20260329100000_wa_rate_limiting.sql` | Atomic message rate limiter (`wa_rate_limits`, `fn_wa_check_rate_limit`) |
| `20260329110000_wa_booking_rate_limit.sql` | Atomic booking limiter (`wa_booking_limits`, `fn_wa_check_booking_limit`) |
| `20260328000000_multi_service_appointments.sql` | Multi-service appointments via junction table |

**To apply all migrations:**
```bash
supabase db push
```

---

## Key TypeScript Interfaces (Edge Functions)

**File:** `supabase/functions/whatsapp-webhook/types.ts`

```typescript
interface MetaMessage {
  from: string
  text?: { body: string }
  audio?: { id: string; mime_type?: string }  // NEW: voice note support
}

interface LlmResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string; type?: string; code?: string }
}

interface AuditLogData {
  business_id: string
  sender_phone: string
  message_text: string
  ai_response?: string  // Can contain action tags or error strings
  tool_calls?: Record<string, unknown>
}
```

---

## Performance Metrics

- **Message → Response:** <2 seconds (Groq Llama latency ~1.2s, overhead ~0.8s)
- **Voice → Transcription:** <3 seconds (Groq Whisper)
- **Database RLS check:** <10ms per query
- **Rate limit check:** <1ms (atomic SQL)
- **Throughput:** Supports ~1,000 concurrent users per Vercel instance

---

## LLM Provider Abstraction

To change LLM providers (e.g., Groq → OpenAI), edit **2 files only**:

**`supabase/functions/whatsapp-webhook/ai-agent.ts` (lines 28–29):**
```ts
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions'  // NEW
const LLM_MODEL   = 'gpt-4-turbo'  // NEW
```

**`lib/actions/voice-assistant.ts` (lines 14–15):**
```ts
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions'  // NEW
const LLM_MODEL   = 'gpt-4-turbo'  // NEW
```

**Environment variable:** No change needed — same `LLM_API_KEY` for all OpenAI-compatible providers (Groq, OpenAI, Anthropic, etc.).

---

## Known Limitations & Future Work

- **Multi-language support:** AI agent currently hardcoded to Spanish. Dynamic language selection in business settings planned.
- **Voice transcription:** Hardcoded to Spanish. Future: make dynamic via business settings.
- **Booking Conflicts:** System detects overlapping appointments; overbooking (same staff, overlapping times) validation planned.
- **AI Reasoning:** Llama 3.3 is fast but may hallucinate on complex edge cases. Consider `llama-3.1-405b` for multi-service reasoning.
- **Voice Assistant Dashboard:** Currently minimal; expansion planned for more voice commands.
- **Custom Reminders:** SMS reminders not yet implemented; planned for future phases.
- **Analytics Export:** CSV/PDF export of reports planned.

---

## Author & Attribution

**Luis C. — Full-Stack Developer**

This project demonstrates:
- Modern Next.js 14 architecture with Server Components and Server Actions
- PostgreSQL RLS multi-tenancy at database level
- Real-time AI integration (Groq + Llama)
- Security best practices (WebAuthn, HMAC, rate limiting)
- PWA & mobile-first UX
- Enterprise-grade data validation and error handling

---

## License

Proprietary. See [INTELLECTUAL_PROPERTY.md](./INTELLECTUAL_PROPERTY.md).

---

**Questions or technical inquiries?** See [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md) for deep dives into:
- Security & Anti-Spam Architecture (3-layer defense)
- WhatsApp AI Agent comprehensive workflow
- Voice transcription (Groq Whisper)
- Push Notifications architecture (RFC 8291)
- Database design & RLS policies
- Error handling & logging strategies
