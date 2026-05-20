# Test Coverage Audit Report — Cronix SaaS

**Date:** 2026-05-19  
**Current Status:** 74 unit tests + 2 integration tests + 11 E2E tests (87 total)  
**Target:** Complete coverage for all critical paths

---

## EXECUTIVE SUMMARY

### Coverage Gaps by Category

| Category | Existing | Missing | Priority |
|----------|----------|---------|----------|
| **Auth & Session** | 5 tests | 8 files | P1 |
| **Payments & Webhooks** | 3 tests | 6 routes + utils | P1 |
| **Dashboard & Admin** | 5 tests | 15+ components | P1 |
| **Components & Hooks** | 7 tests | 25+ files | P3 |
| **Supabase Functions** | 0 tests | 11 functions | P2 |
| **Integration Flows** | 2 tests | 4 critical paths | P3 |
| **E2E Coverage** | 11 tests | 25+ pages | P2 |
| **API Routes** | 2 tests | 12 routes | P3 |

---

## PRIORITY 1: Auth, Payments, Dashboard (Foundation)

### A. Auth & Session Tests (MISSING)

**Scope:** 8 critical files  
**Impact:** Session security, user state, business context

Files needing coverage:
- `lib/auth/get-session.ts` ✗ **CRITICAL** — Authenticates all requests
- `lib/auth/get-business-id.ts` ✗ — Extracts tenant context
- `lib/supabase/server.ts` ✗ — Server client factory
- `lib/supabase/server-cache.ts` ✗ — Server-side cache layer (CURRENTLY BEING MODIFIED)
- `lib/supabase/client.ts` ✗ — Client-side factory
- `lib/supabase/middleware-session.ts` ✗ — Session middleware
- `lib/middleware/with-csrf.ts` ✗ — CSRF protection
- `lib/middleware/with-rate-limit.ts` ✗ — Rate limiting
- `lib/middleware/with-user-status.ts` ✗ — User status validation

**Required Test Cases:**
- `getSession()` returns valid SessionUser with dbUser
- `getSession()` returns null if auth error or user not in DB
- `getSession()` returns null on critical DB failure (security)
- `getBusinessId()` extracts business_id from session
- `getBusinessId()` handles multi-tenant isolation
- Rate limiter tracks quota and rejects on overflow
- CSRF middleware validates tokens
- Middleware chain composition works correctly
- Session middleware persists and refreshes JWT

**Test File Structure:**
```
__tests__/auth/
  ├── get-session.test.ts (7 cases)
  ├── get-business-id.test.ts (4 cases)
  └── session-flow.test.ts (auth → DB → business context)

__tests__/supabase/
  ├── server.test.ts (client creation, mocking)
  ├── middleware-session.test.ts (session persistence)
  └── server-cache.test.ts (cache key generation, TTL)

__tests__/middleware/
  ├── with-csrf.test.ts (token validation)
  ├── with-rate-limit.test.ts (quota enforcement)
  └── with-user-status.test.ts (user activation checks)
```

---

### B. Payment & Webhook Tests (CRITICAL)

**Scope:** 6 files + 3 API routes  
**Impact:** Revenue-critical path, PCI compliance

Files needing coverage:
- `app/api/webhooks/paypal/route.ts` ✗ **CRITICAL**
- `app/api/webhooks/nowpayments/route.ts` ✗ **CRITICAL**
- `lib/payments/paypal.service.ts` ✗
- `lib/payments/nowpayments.service.ts` ✗
- Payment validators and type guards ✗
- `app/[locale]/dashboard/settings/payment-method-modal.tsx` ✓ (covered: 7 cases)
- `app/api/queue/process-saas-payment/route.ts` ✗

**Required Test Cases:**
- Webhook signature verification (PayPal, NowPayments)
- Payment status transitions (pending → completed → failed)
- Idempotency: duplicate webhook payloads ignored
- Invalid signatures rejected with 401/403
- Missing business_id handled securely
- Double-booking prevention on payment
- Rate limiting on webhook endpoints
- Webhook logging for audit trail

**Test File Structure:**
```
__tests__/api/webhooks/
  ├── paypal.webhook.test.ts (8 cases)
  └── nowpayments.webhook.test.ts (8 cases)

__tests__/payments/
  ├── paypal.service.test.ts (6 cases)
  ├── nowpayments.service.test.ts (6 cases)
  └── payment-validators.test.ts (4 cases)

tests/integration/
  └── payment-flow.test.ts (webhook → DB → user confirmation)
```

---

### C. Dashboard & Admin Component Tests (MISSING)

**Scope:** 15+ components + 10 hooks  
**Impact:** 80% of user-facing UI

Components with missing tests:
- `components/theme-toggle.tsx` ✗
- `components/session-timeout.tsx` ✗
- `components/providers.tsx` ✗
- `components/admin/dead-letter-feed.tsx` ✗
- `components/admin/system-status-grid.tsx` ✗
- `components/dashboard/voice-visualizer.tsx` ✗
- `components/dashboard/services-onboarding-banner.tsx` ✗
- `components/layout/sidebar.tsx` ✗
- `components/layout/topbar.tsx` ✗
- `components/layout/dashboard-shell.tsx` ✗
- `components/layout/notification-panel.tsx` ✗
- `components/ui/language-switcher.tsx` ✗
- `components/ui/install-pwa-button.tsx` ✗
- `components/ui/pwa-install-banner.tsx` ✗
- `components/ui/pwa-update-toast.tsx` ✗
- `components/ui/phone-input-flags.tsx` ✗
- `components/ui/password-input.tsx` ✗
- `components/ui/client-select.tsx` ✗
- `components/ui/date-time-picker.tsx` ✗
- `components/ui/passkey-register.tsx` ✗
- `components/ui/passkey-login-button.tsx` ✗

Hooks with missing tests:
- `app/[locale]/dashboard/clients/hooks/use-clients-list.ts` ✗
- `app/[locale]/dashboard/clients/new/hooks/use-new-client-form.ts` ✗
- `app/[locale]/dashboard/clients/[id]/edit/hooks/use-client-edit-form.ts` ✗
- `app/[locale]/dashboard/appointments/hooks/use-appointments-list.ts` ✗
- `app/[locale]/dashboard/services/hooks/use-service-manager.ts` ✗
- `app/[locale]/dashboard/team/hooks/use-team-manager.ts` ✗
- `lib/hooks/use-business-context.ts` ✗
- `lib/hooks/use-pwa-install.ts` ✗
- `lib/hooks/use-pwa-install-fallback.ts` ✗

**Required Test Cases:**
- Theme toggle cycles through light/system/dark
- Session timeout warning appears after inactivity
- Providers render children correctly
- Admin components display real-time status
- Voice visualizer animates on audio input
- Layout components handle responsive breakpoints
- Navigation works for authenticated users
- Password input toggles visibility
- Date picker selects and formats dates
- Hooks fetch and manage state correctly
- Form hooks validate input and submit

**Test File Structure:**
```
__tests__/components/
  ├── theme-toggle.test.tsx (3 cases)
  ├── session-timeout.test.tsx (4 cases)
  ├── providers.test.tsx (2 cases)
  ├── admin/
  │   ├── dead-letter-feed.test.tsx
  │   └── system-status-grid.test.tsx
  ├── dashboard/
  │   ├── voice-visualizer.test.tsx
  │   └── services-onboarding-banner.test.tsx
  ├── layout/
  │   ├── sidebar.test.tsx
  │   ├── topbar.test.tsx
  │   ├── dashboard-shell.test.tsx
  │   └── notification-panel.test.tsx
  ├── ui/
  │   ├── language-switcher.test.tsx
  │   ├── pwa-install-banner.test.tsx
  │   ├── phone-input-flags.test.tsx
  │   ├── password-input.test.tsx
  │   ├── client-select.test.tsx
  │   └── date-time-picker.test.tsx

__tests__/hooks/
  ├── use-clients-list.test.ts
  ├── use-clients-form.test.ts
  ├── use-appointments-list.test.ts
  ├── use-service-manager.test.ts
  ├── use-team-manager.test.ts
  ├── use-business-context.test.ts
  └── use-pwa-*.test.ts (3 tests)
```

---

## PRIORITY 2: Supabase Functions & E2E (Business Logic)

### D. Supabase Edge Functions (MISSING)

**Scope:** 11 functions  
**Impact:** Background jobs, webhooks, cron tasks, real-time processing

Functions needing tests:
1. `supabase/functions/push-notify/index.ts` ✗ (CURRENTLY BEING MODIFIED)
   - Segments users by appointment imminence
   - Sends iOS/Android push notifications
   - Handles provider failures (Firebase, APNs)

2. `supabase/functions/cron-imminent-push/index.ts` ✗ (CURRENTLY BEING MODIFIED)
   - Scheduled job for push notifications
   - Query imminence window (next 1 hour)
   - Trigger push-notify function

3. `supabase/functions/voice-worker/index.ts` ✗
   - Voice AI conversation state machine
   - Handles multi-turn scheduling, cancellation, rescheduling
   - Integrates with STT (Deepgram), LLM, TTS (ElevenLabs)

4. `supabase/functions/whatsapp-webhook/index.ts` ✗
   - Webhook handler for WhatsApp Business API
   - Message routing and status updates
   - Business rule validation

5. `supabase/functions/process-whatsapp/index.ts` ✗
   - Message template rendering
   - Appointment reminders, confirmations
   - Integration with CRM tools

6. `supabase/functions/cron-reminders/index.ts` ✗
   - Scheduled reminder cron job
   - Query reminder schedule
   - Trigger reminder sends

**Required Test Cases:**
- Function entry point handles Request correctly
- Validates environment variables (secrets)
- DB queries return expected shapes
- Error handling and retry logic
- Edge case: empty user segments
- Edge case: provider failure (fallback to email)
- Idempotency: duplicate triggers don't double-send
- Logging captures errors for monitoring

**Test File Structure:**
```
supabase/functions/push-notify/__tests__/
  ├── index.test.ts (main handler)
  ├── modules/auth.test.ts
  ├── modules/push-sender.test.ts
  └── helpers.test.ts

supabase/functions/voice-worker/__tests__/
  ├── index.test.ts
  └── capabilities/
      ├── schedule/fast-path.test.ts ✓ (exists)
      ├── reschedule/fast-path.test.ts ✓ (exists)
      ├── cancel/fast-path.test.ts ✓ (exists)
      └── [other-capabilities]/fast-path.test.ts

supabase/functions/[other-functions]/__tests__/
  └── index.test.ts (each function)
```

---

### E. E2E Tests for Auth Flow (MISSING)

**Scope:** 6 pages  
**Impact:** User onboarding, security validation

Pages needing E2E tests:
- `/register` — signup flow, email validation
- `/login` — password login, error handling
- `/forgot-password` — email request, validation
- `/reset-password` — token validation, security
- `/invite/[code]` — team invitations, onboarding
- `/terms` and `/privacy` — static content, navigation

**Required Test Cases:**
- Register with valid email/password creates user
- Register rejects duplicate email
- Login succeeds with correct credentials
- Login fails with wrong password
- Forgot password sends email link
- Reset password token expires
- Invite code accepts new team member
- Session persists after login
- Logout clears session
- Unauthenticated users redirected to login

**Test File:**
```
tests/e2e/
  ├── auth-register.spec.ts (6 cases)
  ├── auth-login.spec.ts (5 cases)
  ├── auth-password-reset.spec.ts (4 cases)
  └── auth-invite.spec.ts (3 cases)
```

---

### F. E2E Tests for Dashboard (MISSING)

**Scope:** 12 pages  
**Impact:** Core user workflows

Pages needing E2E tests:
- `/dashboard` (main) — dashboard layout, navigation
- `/dashboard/profile` — user profile edit
- `/dashboard/settings` — general settings
- `/dashboard/services` — service CRUD
- `/dashboard/setup` — onboarding wizard
- `/dashboard/team` — team member management
- `/dashboard/referrals` — referral system
- `/dashboard/reports` — reporting and analytics
- `/dashboard/observability` — system health monitoring
- `/dashboard/admin/users` — user management (admin)
- `/dashboard/admin/payments` — payment admin
- `/dashboard/admin/pulse` — system pulse/health

**Required Test Cases:**
- Dashboard loads with correct business context
- Profile edit saves and validates
- Settings persist correctly
- Service CRUD works (create, read, update, delete)
- Setup wizard completes onboarding
- Team members can be added/removed
- Referral links copy correctly
- Reports generate data
- Admin pages show correct data

**Test Files:**
```
tests/e2e/
  ├── dashboard-profile.spec.ts
  ├── dashboard-settings.spec.ts
  ├── dashboard-services.spec.ts
  ├── dashboard-team.spec.ts
  ├── dashboard-referrals.spec.ts
  ├── dashboard-reports.spec.ts
  └── admin-pages.spec.ts
```

---

### G. E2E Tests for Business Flows (MISSING)

**Scope:** 4 major workflows  
**Impact:** Revenue-critical, user satisfaction

Workflows needing E2E tests:
- **Client Management:** Create, search, edit, delete clients
- **Appointments:** Schedule, reschedule, cancel appointments
- **Finances:** Record expenses, view reports, download
- **Payments:** Plan upgrade, payment method, invoices

**Required Test Cases:**
- Create client with all fields
- Search and filter clients
- Edit client details
- Delete client (soft delete)
- Schedule appointment for client
- Reschedule appointment
- Cancel appointment
- Add expense transaction
- View financial summary
- Upgrade to paid plan
- Add payment method
- View invoice history

**Test Files:**
```
tests/e2e/
  ├── clients.spec.ts (8 cases)
  ├── appointments-crud.spec.ts (5 cases)
  ├── finances.spec.ts (5 cases)
  └── plan-upgrade.spec.ts (5 cases)
```

---

## PRIORITY 3: Components, Integration, API Routes

### H. Component Unit Tests (Expanded)

Already covered: `__tests__/components/` has 7 component tests.  
Missing: 20+ additional components (see Priority 1C above).

---

### I. Integration Tests

**Scope:** 4 critical end-to-end flows  
**Current:** 2 tests (ai-booking, repositories)  
**Missing:** 4 additional integration tests

Flows needing integration tests:
1. **Auth Session Flow** — Middleware → Session → Business context
2. **Payment Processing** — Webhook → DB → User notification
3. **Appointment Booking** — Form → AI Booking → DB → Confirmation email
4. **Notification System** — Trigger → Queue → Email/SMS/Push

**Test File Structure:**
```
tests/integration/
  ├── auth-flow.test.ts
  ├── payment-flow.test.ts
  ├── appointment-booking.test.ts
  └── notification-flow.test.ts
```

---

### J. API Route Tests

**Scope:** 12 API routes  
**Current:** 2 tests (health, activity-ping)  
**Missing:** 10 additional route tests

Routes needing coverage:
- `app/api/health/route.ts` ✓ (1 test exists)
- `app/api/activity/ping/route.ts` ✓ (1 test exists)
- `app/api/assistant/token/route.ts` ✗
- `app/api/assistant/tts/route.ts` ✗
- `app/api/assistant/proactive/route.ts` ✗
- `app/api/admin/users/[id]/status/route.ts` ✗
- `app/api/passkey/register/options/route.ts` ✗
- `app/api/passkey/register/verify/route.ts` ✗
- `app/api/passkey/authenticate/options/route.ts` ✗
- `app/api/passkey/authenticate/verify/route.ts` ✗
- `app/api/cron/check-subscriptions/route.ts` ✗
- `app/api/queue/process-saas-payment/route.ts` ✗

**Required Test Cases:**
- Correct HTTP method validation (GET, POST, etc.)
- Request validation (body, params, headers)
- Authentication and authorization
- Response format and status codes
- Error handling and logging
- Edge cases (missing fields, invalid types)

**Test File Structure:**
```
__tests__/api/
  ├── assistant/
  │   ├── token.test.ts
  │   ├── tts.test.ts
  │   └── proactive.test.ts
  ├── passkey/
  │   ├── register-options.test.ts
  │   ├── register-verify.test.ts
  │   ├── authenticate-options.test.ts
  │   └── authenticate-verify.test.ts
  ├── admin/
  │   └── user-status.test.ts
  └── cron/
      └── check-subscriptions.test.ts
```

---

## IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Auth + Payments + Dashboard) — Week 1
- [ ] Auth & Session tests (8 files, ~20 test cases)
- [ ] Payment & Webhook tests (6 files, ~15 test cases)
- [ ] Dashboard & Admin components (15+ components, ~40 test cases)
- [ ] **Estimated:** 75 new tests, ~500 LoC

### Phase 2: Business Logic (E2E + Integration) — Week 2
- [ ] Supabase Functions tests (11 functions, ~30 test cases)
- [ ] E2E Auth flow (6 pages, ~18 test cases)
- [ ] E2E Dashboard (12 pages, ~24 test cases)
- [ ] E2E Business flows (4 workflows, ~20 test cases)
- [ ] **Estimated:** 92 new E2E tests, ~1000 LoC

### Phase 3: Completeness (Components + Integration + API) — Week 3
- [ ] Component unit tests (20+ components, ~40 test cases)
- [ ] Integration tests (4 flows, ~16 test cases)
- [ ] API route tests (10 routes, ~30 test cases)
- [ ] **Estimated:** 86 new tests, ~600 LoC

---

## TESTING PATTERNS & CONVENTIONS

### Unit Tests (vitest)
- Component tests: React Testing Library + vitest
- Service tests: Mock dependencies, test pure functions
- Middleware tests: Composition and chain validation

### Integration Tests (vitest + real DB)
- Real Supabase client (service-role key)
- Cleanup after each test
- Skip if `SUPABASE_SERVICE_ROLE_KEY` not set

### E2E Tests (Playwright)
- Authenticated context via `auth.setup.ts`
- Baseline E2E user in Supabase
- Multi-browser: Chromium, Firefox, WebKit
- Visual regression for critical UI

### Mocking Strategy
- Mock Supabase by default in unit tests
- Mock external services (SendGrid, Firebase, etc.)
- Real DB only in integration tests
- Real app only in E2E tests

---

## TEST EXECUTION

```bash
# Unit & Integration (vitest)
npm run test                    # All vitest tests
npm run test __tests__          # Unit tests only
npm run test tests/integration  # Integration tests only
npm run test -- --coverage      # With coverage report

# E2E (Playwright)
npm run test:e2e               # All browsers
npm run test:e2e -- --headed   # Visual mode
npm run test:e2e:smoke         # Smoke tests only

# Coverage Summary
npm run test -- --coverage --reporter=verbose
```

---

## SUCCESS CRITERIA

✅ All 74 existing tests pass  
✅ 75+ new unit tests added (Phase 1)  
✅ 92+ new E2E tests added (Phase 2)  
✅ 86+ new component/integration/API tests (Phase 3)  
✅ **Total: 327+ new tests**  
✅ Coverage thresholds met (70% lines, functions, branches)  
✅ No breaking changes to existing functionality  
✅ Tests follow project conventions (no comments, strong typing, SOLID)

---

## NOTES

- **Unstaged changes:** `server-cache.ts`, `push-notify`, `cron-imminent-push` are under modification — tests should be added after these stabilize
- **Integration tests:** Require `.env.local` with `SUPABASE_SERVICE_ROLE_KEY`
- **E2E baseline:** Requires `setup-e2e-data.ts` to populate test business/users
- **Future:** Consider snapshot testing for visual components
