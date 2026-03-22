# Cronix — Appointment Management SaaS

> Multi-tenant SaaS platform for managing appointments, clients, services and finances. Built for service businesses: salons, clinics, studios, and any business that runs on bookings.

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat-square&logo=supabase)
![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?style=flat-square&logo=tailwindcss)
![Vitest](https://img.shields.io/badge/Vitest-tested-6E9F18?style=flat-square&logo=vitest)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square&logo=vercel)
![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?style=flat-square&logo=pwa)

---

## Features

### Authentication & Security
- Email + password registration (email confirmation required)
- Google OAuth login
- Forgot password / Reset password flow
- Row Level Security (RLS) on all tables — every tenant sees only their own data
- DB trigger `handle_new_user()` auto-creates user profile on signup
- Protected routes via Next.js middleware
- **Session timeout**: 30-minute inactivity enforcement (server-side via middleware cookie)

### Visual Calendar Dashboard
- Monthly calendar view with appointment density per day
- Day panel — tap any day to see its appointment list
- Appointment side panel — full details, status change, delete without leaving the page
- Status management: Confirm / Complete / Cancel / No-show
- Real-time stats: today's appointments, monthly revenue, pending count

### Appointment Management
- Create appointments with client, service, date/time, and notes
- Double-booking detection with configurable warn/block rules
- Past date/time booking prevention
- Inline service creation from the appointment form
- Conflict detection for overlapping time slots

### Client Management
- Full CRUD with soft delete
- Tags: VIP, Frequent, New
- Per-client appointment history and debt tracking
- Stats: total visits, total spent, average ticket
- Payment registration with partial payment support

### Services
- Create / edit / delete services
- Duration (minutes), price, color (8 options for calendar visualization)
- Active / inactive toggle
- Category grouping
- Onboarding banner for new businesses with no services

### Finances
- Transaction tracking (income by appointment)
- Expense tracking with categories
- Monthly revenue, expenses, and net profit summary
- Separate views for transactions and expenses history

### Reports
- Monthly overview: appointments, revenue, expenses, net profit
- Completion and cancellation rates
- Revenue breakdown by service
- Downloadable plain-text report

### Settings & Profile
- Business info: name, category, working hours schedule
- User profile: name, phone, email, avatar upload (2 MB max, Supabase Storage)
- Password change with confirmation
- Dark mode UI (default)

### Progressive Web App (PWA)
- Installable on Android and iOS
- Offline-ready via Workbox service worker
- Branded manifest: theme color `#0062FF`, dark background `#0F0F12`
- Maskable icons (192x192 and 512x512)
- One-tap install button in the sidebar (Android Chrome / Chromium)
- Auto-hides when app is already installed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 3.4 + custom design tokens |
| Backend / DB | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email + Google OAuth) |
| Storage | Supabase Storage (avatars bucket) |
| Queries | Supabase JS Client v2 |
| Forms | React Hook Form + Zod |
| Date handling | date-fns v4 |
| Icons | Lucide React |
| PWA | next-pwa 5.6 (Workbox) |
| Testing | Vitest + @vitest/coverage-v8 |
| Deployment | Vercel |
| Bundler | Turbopack (dev) |

---

## Architecture

Cronix follows a layered architecture designed for decoupling and scalability.

```
Request
  └─ Next.js Middleware (auth guard + inactivity timeout)
       └─ Server Component / Server Action
            └─ Repository  (Supabase query layer)
                 └─ Use Case (pure business logic)
```

### Key patterns

**Repository layer** (`lib/repositories/`)
Abstracts all Supabase queries. Each domain has its own repo file. No business logic here — only data access.

**Use Cases** (`lib/use-cases/`)
Pure TypeScript functions with zero framework dependencies. No Supabase, no React, no Next.js. Fully testable in isolation. Contains rules like double-booking evaluation, debt calculation, and payload building.

**Result type** (`types/result.ts`)
Typed discriminated union used as the contract between layers:
```ts
type Result<T> = { data: T; error: null } | { data: null; error: string }
```
Replaces `throw/catch` at boundaries. Ready for backend decoupling — when the API layer is extracted, only the fetcher changes, not the callers.

**Error boundaries**
- `app/dashboard/error.tsx` — catches unhandled Server Component errors in `/dashboard`
- Client components use local `fetchError` state to surface failures to the user (no silent `console.error`)

**`useFetch` hook** (`lib/hooks/use-fetch.ts`)
Centralized async data-fetching hook with typed `{ data, loading, error, refetch }`. Replaces scattered try/catch patterns in Client Components.

---

## Database Schema

```
businesses
├── id (uuid, PK)
├── name, category
├── owner_id (→ auth.users)
├── plan
└── settings (jsonb)           ← working hours, notifications config

users
├── id (uuid, PK → auth.users)
├── name, email, phone
├── role (owner | admin | staff)
├── business_id (→ businesses)
├── avatar_url
└── color

clients
├── id, name, email, phone
├── business_id (→ businesses)
├── tags (text[])
├── birthday, notes
├── total_appointments, total_spent
└── deleted_at                 ← soft delete

services
├── id, name, description
├── business_id (→ businesses)
├── duration_min, price
├── color, category
└── is_active

appointments
├── id
├── business_id (→ businesses)
├── client_id (→ clients)
├── service_id (→ services)
├── assigned_user_id (→ users)
├── start_at, end_at
├── status (pending | confirmed | completed | cancelled | no_show)
├── is_dual_booking
└── notes

transactions
├── id, business_id
├── appointment_id
├── net_amount, payment_method
└── paid_at

expenses
├── id, business_id
├── amount, category
└── expense_date
```

---

## Security

- **RLS** enabled on all 7 tables
- Isolation pattern: `business_id IN (SELECT business_id FROM users WHERE id = auth.uid())`
- `users` table: select open to authenticated, insert/update restricted to own record
- `businesses` table: insert restricted to `owner_id = auth.uid()`
- `handle_new_user()` trigger runs with `SECURITY DEFINER` to bypass RLS at signup
- 9 performance indexes on high-traffic columns
- **Session timeout**: 30 min inactivity → server-side `signOut()` + redirect with user-facing message
- **JWT expiry**: configure to `43200` seconds (12h) in Supabase Dashboard → Auth settings

---

## Testing

```bash
npm run test           # run all tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

**Coverage:**

| Layer | Target | Actual |
|---|---|---|
| Use Cases | 85% branch | 91.1% |
| Validations | 90% | 100% |

Tests are in `__tests__/` and cover:
- Use case logic (double booking, debt calculation, working hours parsing)
- Zod validation schemas (appointments, clients, services)

---

## Project Structure

```
cronix/
├── app/
│   ├── page.tsx                        # Landing / redirect
│   ├── login/                          # Login page + server actions
│   ├── register/
│   ├── forgot-password/
│   ├── reset-password/
│   └── dashboard/
│       ├── page.tsx                    # Calendar dashboard
│       ├── layout.tsx                  # Shell + session guard
│       ├── error.tsx                   # Error boundary
│       ├── appointments/
│       ├── clients/
│       ├── services/
│       ├── finances/
│       ├── reports/
│       ├── profile/
│       ├── settings/
│       └── setup/                      # Onboarding wizard
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   └── topbar.tsx
│   ├── dashboard/
│   └── ui/                             # Button, Card, Badge, Avatar, InstallPwaButton...
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # Browser client
│   │   ├── server.ts                   # Server client (SSR)
│   │   └── middleware.ts               # Session refresh + inactivity timeout
│   ├── repositories/                   # Data access layer (one file per domain)
│   │   ├── appointments.repo.ts
│   │   ├── clients.repo.ts
│   │   ├── services.repo.ts
│   │   ├── finances.repo.ts
│   │   ├── users.repo.ts
│   │   ├── businesses.repo.ts
│   │   └── index.ts
│   ├── use-cases/                      # Pure business logic (no framework deps)
│   │   ├── appointments.use-case.ts
│   │   ├── finances.use-case.ts
│   │   └── business.use-case.ts
│   ├── hooks/
│   │   ├── use-business-context.ts     # Session + supabase client provider
│   │   ├── use-fetch.ts                # Centralized async fetch hook
│   │   └── use-pwa-install.ts          # beforeinstallprompt handler
│   ├── validations/                    # Zod schemas
│   └── utils.ts
├── types/
│   ├── index.ts                        # Domain types
│   ├── result.ts                       # Result<T> type
│   └── database.types.ts              # Auto-generated from Supabase
├── __tests__/
│   ├── use-cases/
│   └── validations/
├── public/
│   ├── manifest.json                   # PWA manifest
│   ├── sw.js                           # Service worker (generated by next-pwa)
│   ├── icon-192x192.png
│   └── icon-512x512.png
├── middleware.ts                       # Route protection
└── next.config.js                      # next-pwa config
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- Supabase project
- Vercel account (for deployment)

### 1. Clone the repository
```bash
git clone https://github.com/ROMEROLUIS15/cronix.git
cd cronix
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env.local` file at the root:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Set up the database
Run the following in Supabase SQL Editor (in order):
1. Create tables: `businesses`, `users`, `clients`, `services`, `appointments`, `transactions`, `expenses`
2. Enable RLS and apply policies
3. Create the `handle_new_user()` trigger
4. Create the `avatars` storage bucket
5. Apply performance indexes
6. Set JWT expiry to `43200` seconds in Dashboard → Authentication → Settings

### 5. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## Available Scripts

```bash
npm run dev           # development server (Turbopack)
npm run build         # production build
npm run start         # production server
npm run lint          # ESLint
npm run typecheck     # TypeScript check (no emit)
npm run test          # run Vitest
npm run test:watch    # Vitest watch mode
npm run test:coverage # coverage report
```

---

## Git Workflow

```
main        ← production (auto-deploys to Vercel)
develop     ← integration branch
feat/*      ← new features
fix/*       ← bug fixes
```

```bash
git checkout develop
git checkout -b feat/my-feature
# make changes
git commit -m "feat: description"
git push origin feat/my-feature
# Open Pull Request → develop
```

---

## Deployment

Deployed on **Vercel** with automatic deployments from `main`.

```bash
npm run build     # verify build passes before pushing
```

PWA assets (`sw.js`, `workbox-*.js`) are generated automatically by `next-pwa` on every build and served from `/public`.

---

## Author

**Luis Romero**
- GitHub: [@ROMEROLUIS15](https://github.com/ROMEROLUIS15)

---

## License

Private project — all rights reserved.
