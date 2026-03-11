# 🗓️ Agendo — Appointment Management SaaS

> Plataforma SaaS para gestión de citas, clientes, servicios y finanzas. Diseñada para negocios de servicios como salones, consultorios, estudios y cualquier negocio que trabaje por citas.

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat-square&logo=supabase)
![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?style=flat-square&logo=tailwindcss)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square&logo=vercel)

---

## ✨ Features

### 🔐 Authentication & Security
- Register with email + password (email confirmation required)
- Login with credentials or Google OAuth
- Forgot password / Reset password flow
- Row Level Security (RLS) — every user only sees their own business data
- DB trigger `handle_new_user()` auto-creates user profile on signup
- Protected routes via Next.js middleware

### 📅 Visual Calendar Dashboard
- Day view — hourly timeline with color-coded appointment blocks
- Week view — 7-column grid with per-day appointment counts
- Navigate forward/back by day or week
- "Today" quick-jump button
- Click any appointment → side panel slides in

### 🗂️ Appointment Side Panel
- Full appointment details without leaving the page
- Change status: Confirm / Complete / Cancel
- Link to full edit page

### 👥 Client Management
- Create, edit, soft-delete clients
- Tags: VIP, Frequent, New
- Appointment history per client
- Stats: total visits, total spent, average ticket

### 🛠️ Services CRUD
- Create/edit/delete services
- Color picker (8 colors) for calendar visualization
- Duration (minutes) and price
- Categories and active/inactive toggle
- Services onboarding banner for new businesses

### 💰 Finances
- Transaction and expense tracking
- Monthly revenue stats

### 📊 Reports
- Business performance overview

### ⚙️ Settings & Profile
- Business info: name, category, logo, schedule
- User profile: name, phone, email, avatar upload (2MB max)
- Optional password change with confirmation field
- Dark/light mode toggle

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3.4 |
| Backend / DB | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email + Google OAuth) |
| Storage | Supabase Storage (avatars bucket) |
| ORM / Queries | Supabase JS Client v2 |
| Forms | React Hook Form + Zod |
| Date handling | date-fns v4 |
| Icons | Lucide React |
| Deployment | Vercel |
| Bundler | Turbopack (Next.js) |

---

## 🗄️ Database Schema

```
businesses
├── id (uuid, PK)
├── name
├── category
├── owner_id (→ auth.users)
├── plan
└── settings (jsonb)

users
├── id (uuid, PK → auth.users)
├── name
├── email
├── phone
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
└── deleted_at (soft delete)

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
├── status (pending|confirmed|completed|cancelled|no_show)
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
└── date
```

---

## 🔒 Security

- **RLS (Row Level Security)** active on all 7 tables
- Pattern: each table filtered by `business_id IN (SELECT business_id FROM users WHERE id = auth.uid())`
- `users` table: select open to authenticated, insert/update restricted to own record
- `businesses` table: insert restricted to `owner_id = auth.uid()`
- DB trigger `handle_new_user()` runs with `SECURITY DEFINER` to bypass RLS at signup
- 9 performance indexes on high-traffic columns

---

## 📁 Project Structure

```
agendo/
├── app/
│   ├── page.tsx                    # Landing / redirect
│   ├── login/                      # Login page + actions
│   ├── register/                   # Register page + actions
│   ├── forgot-password/            # Password recovery
│   ├── reset-password/             # Password reset
│   └── dashboard/
│       ├── page.tsx                # Visual calendar dashboard
│       ├── layout.tsx              # Dashboard shell + session
│       ├── appointments/
│       │   ├── page.tsx            # Appointments list
│       │   └── new/page.tsx        # New appointment form
│       ├── clients/
│       │   ├── page.tsx            # Clients list
│       │   ├── new/page.tsx        # New client
│       │   └── [id]/
│       │       ├── page.tsx        # Client detail
│       │       └── edit/page.tsx   # Edit / delete client
│       ├── services/
│       │   └── page.tsx            # Services CRUD
│       ├── finances/               # Transactions & expenses
│       ├── reports/                # Business reports
│       ├── profile/
│       │   ├── page.tsx            # User profile + avatar
│       │   └── actions.ts          # Profile server actions
│       ├── settings/
│       │   └── page.tsx            # Business settings
│       └── setup/
│           ├── page.tsx            # Onboarding wizard
│           └── actions.ts          # Business creation
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx             # Navigation sidebar
│   │   └── topbar.tsx              # Top navigation bar
│   ├── dashboard/
│   │   └── services-onboarding-banner.tsx
│   └── ui/                         # Reusable components
│       ├── button.tsx
│       ├── card.tsx
│       ├── badge.tsx
│       └── password-input.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   └── server.ts               # Server Supabase client
│   ├── auth/
│   │   └── get-session.ts          # Session helper
│   └── validations/
│       └── auth.ts                 # Zod schemas
├── types/
│   ├── index.ts                    # Domain types
│   └── database.types.ts           # Auto-generated from Supabase
└── middleware.ts                   # Route protection
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project
- A Vercel account (for deployment)

### 1. Clone the repository
```bash
git clone https://github.com/ROMEROLUIS15/Agendo_appointment_system.git
cd Agendo_appointment_system
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env.local` file:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Set up the database
Run these in Supabase SQL Editor in order:
1. Create tables (businesses, users, clients, services, appointments, transactions, expenses)
2. Enable RLS and apply policies
3. Create the `handle_new_user()` trigger
4. Create the `avatars` storage bucket
5. Apply performance indexes

### 5. Run development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## 🌿 Git Workflow

```
main        ← production (auto-deploys to Vercel)
develop     ← integration branch
feat/*      ← individual features
fix/*       ← bug fixes
```

**Example:**
```bash
git checkout develop
git checkout -b feat/my-feature
# make changes
git add .
git commit -m "feat: description"
git push origin feat/my-feature
# Open Pull Request → develop on GitHub
```

---

## 📦 Deployment

This project is deployed on **Vercel** with automatic deployments from the `main` branch.

```bash
npm run build     # production build
npm run typecheck # TypeScript check
npm run lint      # ESLint
```

---

## 👨‍💻 Author

**Luis Romero**
- GitHub: [@ROMEROLUIS15](https://github.com/ROMEROLUIS15)

---

## 📄 License

Private project — all rights reserved.
