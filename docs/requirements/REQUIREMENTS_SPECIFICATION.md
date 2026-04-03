<div align="center">

<img src="https://img.shields.io/badge/▶-AGENDO-EA580C?style=for-the-badge&labelColor=1C0A00&color=EA580C" alt="Agendo" height="42"/>

# Agendo

### *Your business in control, your clients in order.*

**Multi-Tenant SaaS Platform for Service Business Appointment Management**

---

[![Next.js](https://img.shields.io/badge/Next.js-14+-000000?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x_Strict-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_15-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-06B6D4?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![Zod](https://img.shields.io/badge/Zod-Validated-3068B7?style=for-the-badge)](https://zod.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-EA580C?style=for-the-badge)](LICENSE)
[![PRD](https://img.shields.io/badge/PRD-v1.0-EA580C?style=for-the-badge)](docs/PRD.md)

<br/>

**Manage appointments, clients, and finances · Automatic reminders via WhatsApp and Email**
**Decoupled architecture · Extreme multi-tenant security · Dual client agenda**

<br/>

[Live Demo](https://demo.agendo.app) &nbsp;·&nbsp; [Documentation](https://docs.agendo.app) &nbsp;·&nbsp; [Report Bug](issues) &nbsp;·&nbsp; [Request Feature](issues)

</div>

---

## Table of Contents

- [General Description](#general-description)
- [Brand Identity and Color Palette](#brand-identity--color-palette)
- [Main Features](#main-features)
- [Dual Agenda — Key Differentiator](#-dual-agenda--the-key-feature-that-sets-us-apart)
- [Technology Stack](#technology-stack)
- [Database-Agnostic Architecture](#database-agnostic-architecture)
- [Validation and Typing with Zod + TypeScript](#robust-validation-and-typing-zod--typescript)
- [Extreme Multi-Tenant Security](#extreme-multi-tenant-security)
- [Installation Guide](#installation-guide)
- [Environment Variables](#environment-variables)
- [Complete Database Schema](#complete-database-schema)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contribution](#contribution)
- [License](#license)

---

## General Description

**Agendo** is a multi-tenant SaaS appointment management platform designed specifically for service businesses in Latin America and the Spanish-speaking world (though fully localized for global use). It eliminates daily operational friction: paper agendas, chaotic WhatsApp groups, and improvised spreadsheets.

With Agendo, every business owner has their own completely isolated space to manage their agenda, clients, income, and reports — all from a modern dashboard accessible from any device.

### Who is Agendo for?

| Business Type | Main Use Case |
|---|---|
| 💇 Salons and Beauty Parlors | Agenda by service type, pre-treatment reminders |
| ✂️ Barber Shops | Fast turns with **daily dual agenda** per client |
| 🔧 Auto Repair Shops | Appointment control by vehicle and service history |
| 🩺 Medical Offices | Basic history, private notes, and appointment reminders |
| 🧠 Psychologists / Therapists | Recurrent sessions, privacy guaranteed by RLS |
| 💅 Aesthetic Centers | Multi-service on the same day (nails + massage + facial) |
| 💼 Any service business | Agenda + CRM + Finances + Reports |

---

## Brand Identity & Color Palette

### Design Philosophy

**Visual personality: Energetic and approachable.** Agendo is made for the barber shop owner, the aesthetician, and the therapist — active, practical people who have no time to waste. The visual identity reflects that: no corporate coldness, no excess of icy minimalism. Real energy, direct interface.

The color system is built on **Fire Orange** (`#EA580C`) as primary — one of the few colors that triggers attention and action without generating anxiety, and which is practically empty territory in the appointment app market. It is complemented by a very dark background in dark mode (`#150A00`) that creates a dramatic and premium contrast, and warm white in light mode (`#FFFBF7`) that avoids the coldness of pure white.

### Main Palette

```
 FIRE ORANGE (Primary)          LIGHT MODE                DARK MODE
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 brand-50   → #FFF7ED           bg-base:     #FFFBF7       bg-base:     #150A00
 brand-100  → #FFEDD5           bg-surface:  #FFF7ED       bg-surface:  #1C0D00
 brand-200  → #FED7AA           bg-card:     #FFFFFF       bg-card:     #241100
 brand-300  → #FDBA74           text-base:   #1C0A00       text-base:   #FFF7ED
 brand-400  → #FB923C           text-muted:  #78350F       text-muted:  #C2763D
 brand-500  → #F97316           border:      #FED7AA       border:      #3D1F00
 brand-600  → #EA580C  ◀ BASE   ring:        #EA580C       ring:        #EA580C
 brand-700  → #C2410C           shadow:      rgba(0,0,0,0.06)  shadow:  rgba(0,0,0,0.4)
 brand-800  → #9A3412
 brand-900  → #7C2D12           SEMANTICS (universal — no mode changes)
                                ──────────────────────────────────────────────────
 WARM NEUTRALS                  success:     #22C55E       (natural green)
 ━━━━━━━━━━━━━━━━━━━            warning:     #EAB308       (warm yellow)
 warm-50  → #FFFBF7             danger:      #EF4444       (red)
 warm-100 → #FEF3C7             info:        #3B82F6       (blue)
 warm-900 → #1C0A00             pending:     #F97316       (medium orange)
                                confirmed:   #22C55E
                                completed:   #6B7280
                                cancelled:   #EF4444
                                dual:        #EA580C  ← ⭐ Dual agenda (brand orange)
```

### Why this orange and not yellow?

Yellow `#FFFF00` communicates caution and construction (traffic signs, hazard tape). Orange `#EA580C` communicates positive energy, action, and proximity — it is the color of WhatsApp notifications, Amazon's call-to-action, and most delivery apps that want to feel urgent but friendly. For Agendo, which lives on quick action (booking, confirming, reminding), that message is perfect.

### Configuration in `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class', // Controlled by next-themes — FOUC-free
  theme: {
    extend: {
      colors: {
        // ── Fire Orange (main brand) ───────────────────
        brand: {
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C', // ← primary: buttons, links, active icons
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
        },
        // ── Warm Neutrals (backgrounds and text) ─────────────────
        warm: {
          50:  '#FFFBF7',
          100: '#FEF3C7',
          200: '#FDE68A',
          800: '#3D1F00',
          900: '#1C0A00',
        },
        // ── Semantic Tokens (resolve via CSS vars) ─────────
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface:    'hsl(var(--surface))',
        border:     'hsl(var(--border))',
        muted:      {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        // Inter: legible, modern, no excess formality
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        // Orange-tinted shadows for dark mode
        'brand-sm': '0 1px 3px rgba(234, 88, 12, 0.12)',
        'brand-md': '0 4px 12px rgba(234, 88, 12, 0.18)',
        'brand-lg': '0 8px 30px rgba(234, 88, 12, 0.22)',
      },
    },
  },
}
export default config
```

### CSS Tokens in `globals.css`

```css
/* app/globals.css */
@layer base {
  :root {
    /* ── LIGHT MODE ─────────────────────────────── */
    --background:        28 100% 99%;   /* #FFFBF7 — warm white */
    --foreground:        16 100% 8%;    /* #1C0A00 — warm near-black */
    --surface:           30 100% 97%;   /* #FFF7ED */
    --card:              0   0%  100%;  /* #FFFFFF */
    --card-foreground:   16 100% 8%;
    --border:            30  97% 87%;   /* #FED7AA */
    --muted:             30  60% 96%;
    --muted-foreground:  25  80% 28%;   /* #78350F */
    --primary:           20  90% 49%;   /* #EA580C */
    --primary-foreground: 0   0% 100%;
    --radius: 0.625rem;
  }

  .dark {
    /* ── DARK MODE ────────────────────────────── */
    --background:        20 100% 6%;    /* #150A00 — deep warm black */
    --foreground:        30 100% 98%;   /* #FFF7ED */
    --surface:           20 100% 8%;    /* #1C0D00 */
    --card:              20 100% 10%;   /* #241100 */
    --card-foreground:   30 100% 98%;
    --border:            20  90% 18%;   /* #3D1F00 */
    --muted:             20  70% 14%;
    --muted-foreground:  25  55% 51%;   /* #C2763D */
    --primary:           20  90% 49%;   /* #EA580C — same in both modes */
    --primary-foreground: 0   0% 100%;
  }
}
```

---

## Main Features

### Pro Appointment Management
- Interactive calendar: **Daily · Weekly · Monthly** views
- Create, reschedule (drag & drop), and cancel appointments in real-time
- **Dual agenda per client** on the same day (see dedicated section)
- Semantic color coding by appointment status
- Appointment assignment to specific employees
- Real-time slot overlap validation

### Smart Reminders
- Automatic notifications via **WhatsApp Business API** and **Email**
- Configurable time window per tenant (24h, 2h, custom)
- Message templates with dynamic variables: `{name}` `{service}` `{date}` `{time}`
- Asynchronous message queue — app doesn't block if service fails
- Complete log: `pending` → `sent` → `delivered` → `read` / `failed`

### Client CRM
- Full profile: name, phone, email, birthday, internal notes, tags
- Chronological history of all appointments and received services
- Calculated metrics: visit frequency, total spend, average ticket
- Real-time search (debounced) + advanced filtering by tags and frequency

### Financial Module
- Payment recording: amount, method, discounts, and tips per appointment
- Service catalog with adjustable base prices during billing
- Operating expenses by category with receipt attachments
- Dashboard with real-time income/expenses/net profit

### PDF Reports
- Appointment reports: weekly, monthly, and yearly
- Financial balance with income vs. expense charts
- Direct PDF export with business branding
- Generated 100% in-browser with `@react-pdf/renderer` (zero server load)

### Authentication and Multi-Tenancy
- Supabase Auth: registration, login, OAuth (Google), magic links
- **Total isolation** between tenants using PostgreSQL RLS
- Granular roles: `owner` · `employee` · `platform_admin`
- Secure sessions with JWT + rotating refresh tokens

---

## ⭐ Dual Agenda — The Key Feature that Sets Us Apart

> **"The client asked for a haircut at 10:00 and coloring at 3:00 PM. With Agendo, that's possible in two clicks."**

Most appointment systems block the client once they have an active appointment on a given day. **Agendo breaks that limitation** with a smart agenda engine that allows multiple appointments on the same day for a single client.

### How it works technically

#### 1. Database Validation

```sql
-- Function to count a client's active appointments on a specific date
CREATE OR REPLACE FUNCTION count_client_appointments_on_date(
  p_business_id  UUID,
  p_client_id    UUID,
  p_date         DATE,
  p_exclude_id   UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM appointments
  WHERE business_id = p_business_id
    AND client_id   = p_client_id
    AND status      NOT IN ('cancelled', 'no_show')
    AND DATE(start_at AT TIME ZONE 'UTC') = p_date
    AND (p_exclude_id IS NULL OR id != p_exclude_id);
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

#### 2. UX Flow for Dual Agenda

```
[User creates appointment] → [Selects client + date]
          │
          ▼
  [count_client_appointments_on_date()]
          │
    ┌─────┴──────────────────┐
    │                        │
  count=0                 count=1                    count≥2
    │                        │                          │
    ▼                        ▼                          ▼
[✅ Proceed             [⚠️ Confirmation         [🚫 Blocked]
 normally]               modal]                 "Dual agenda
                         "Already has 1 appt.    limit reached"
                          Add 2nd?"
                                │
                           [Confirms]
                                │
                                ▼
                    [✅ Appt created with
                     is_dual_booking=true]
```

---

## Technology Stack

```
LAYER               TECHNOLOGY                          PURPOSE
─────────────────────────────────────────────────────────────────────────────
Frontend            Next.js 14+ (App Router)            Core Framework, SSR/RSC
Language            TypeScript (strict mode)            End-to-end type-safety
Styling             Tailwind CSS 3.x                    Utility-first, design tokens
Components          shadcn/ui + Radix UI                WAI-ARIA accessibility
Theme               next-themes                         FOUC-free dark mode
─────────────────────────────────────────────────────────────────────────────
Database            Supabase (PostgreSQL 15)            Multi-tenant with native RLS
Authentication      Supabase Auth                       JWT, OAuth, magic links
Real-time           Supabase Realtime                   Synced calendar
Edge Functions      Supabase Edge Functions             Notification cron
─────────────────────────────────────────────────────────────────────────────
Validation          Zod 3.x                             Type-safe schemas client+server
Forms               React Hook Form 7.x                 Performance, Zod integration
State/Cache         TanStack Query 5.x                  Server state, optimistic updates
─────────────────────────────────────────────────────────────────────────────
PDF Generation      @react-pdf/renderer                 In-browser PDF, zero server load
Email               Resend + React Email                Transactional, high deliverability
WhatsApp            Groq Cloud API (Whisper + Llama)    Automated AI reminders
i18n                next-intl 3.x                       Native App Router integration
─────────────────────────────────────────────────────────────────────────────
Testing             Vitest + Testing Library            Unit + integration tests
E2E                 Playwright                          Critical flow testing
Deploy              Vercel                              CI/CD + Edge Network
Monitoring          Sentry + Vercel Analytics           Errors + Core Web Vitals
─────────────────────────────────────────────────────────────────────────────
```

---

## Database-Agnostic Architecture

> **Fundamental Principle:** *Agendo's business logic doesn't know (nor care) where the data lives.*

Agendo implements the **Repository Pattern** with a full abstraction layer. If you decide to migrate from Supabase to PlanetScale, Neon, or any other database tomorrow, **the frontend and business logic remain 100% intact**.

---

## Extreme Multi-Tenant Security

> **Absolute Guarantee:** No user can view, modify, or delete another business's data, even if they know the UUIDs of its records.

### Layered Security Architecture

```
LAYER 1: JWT Claims      → Token includes business_id as custom claim
LAYER 2: Server Actions  → Explicit validation businessId === session.businessId
LAYER 3: RLS Policies    → PostgreSQL rejects queries violating tenant at DB level
LAYER 4: Soft Delete     → Deleted data never vanishes (full audit)
```

---

*English version maintained by the Cronix Core Team.*
