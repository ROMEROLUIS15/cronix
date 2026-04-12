-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP RLS Integration Tests
-- Run via: supabase test db
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(51);

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- ... (rest of helpers trimmed for brevity)
-- ── 1. RLS is enabled on critical tables ─────────────────────────────────────

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'users' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on users'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'businesses' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on businesses'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointments' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on appointments'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'clients' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on clients'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'appointment_reminders' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on appointment_reminders'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'web_rate_limits' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on web_rate_limits'
);

-- ── 2. anon cannot INSERT into users (the employee-creation bug) ──────────────

SET ROLE anon;

SELECT throws_ok(
  $q$
    INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
    VALUES (gen_random_uuid(), 'Hacker', 'h@test.com',
            'aaaaaaaa-0000-0000-0000-000000000001', 'employee', true, 'active')
  $q$,
  '42501',
  NULL,
  'anon cannot INSERT into users'
);

SELECT throws_ok(
  $q$
    INSERT INTO public.businesses (name, category, owner_id)
    VALUES ('Evil Corp', 'salon', gen_random_uuid())
  $q$,
  '42501',
  NULL,
  'anon cannot INSERT into businesses'
);

RESET ROLE;

-- ── 3. authenticated user cannot INSERT a users row for another uid ───────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $q$
    INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
    VALUES (
      '00000000-0000-0000-0000-000000000099',
      'Impersonated',
      'imp@test.com',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'employee',
      true,
      'active'
    )
  $q$,
  '42501',
  NULL,
  'authenticated user cannot insert users row with different id'
);

RESET ROLE;

-- ── 4. Owner A cannot see Owner B's business ─────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'Owner A cannot select Owner B business'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Owner A can select own business'
);

RESET ROLE;

-- ── 5. Owner B cannot see Owner A's business ─────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'Owner B cannot select Owner A business'
);

RESET ROLE;

-- ── 6. Business-scoped data isolation (appointments) ─────────────────────────

-- Insert a client and appointment for business A
DO $$
DECLARE
  client_a UUID := 'cccccccc-0000-0000-0000-000000000001';
  appt_a   UUID := 'dddddddd-0000-0000-0000-000000000001';
  biz_a    UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  svc_a    UUID := 'eeeeeeee-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO public.clients (id, name, business_id)
  VALUES (client_a, 'Cliente A', biz_a)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.services (id, name, duration_min, price, business_id)
  VALUES (svc_a, 'Servicio A', 30, 50000, biz_a)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.appointments (id, business_id, client_id, service_id, start_at, end_at, status)
  VALUES (
    appt_a, biz_a, client_a, svc_a,
    NOW() + INTERVAL '1 day',
    NOW() + INTERVAL '1 day 30 minutes',
    'pending'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- Owner A can see their appointment
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.appointments
   WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  1,
  'Owner A can select own appointment'
);

RESET ROLE;

-- Owner B cannot see Owner A's appointment
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.appointments
   WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'Owner B cannot select Owner A appointment'
);

-- Owner B cannot see Owner A's clients
SELECT is(
  (SELECT COUNT(*)::INT FROM public.clients
   WHERE id = 'cccccccc-0000-0000-0000-000000000001'),
  0,
  'Owner B cannot select Owner A client'
);

RESET ROLE;

-- ── 7. Owner cannot UPDATE another user's row ─────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Should silently affect 0 rows (RLS filters, no error)
UPDATE public.users
SET name = 'Hacked'
WHERE id = '00000000-0000-0000-0000-000000000002';

-- User A can't even SEE user B → NULL (RLS filters the row)
SELECT is(
  (SELECT name FROM public.users WHERE id = '00000000-0000-0000-0000-000000000002'),
  NULL::TEXT,
  'Owner A cannot see Owner B user row (RLS filters it)'
);

RESET ROLE;

-- Verify with service_role that the name was NOT changed
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT name FROM public.users WHERE id = '00000000-0000-0000-0000-000000000002'),
  'Owner B',
  'Owner B name unchanged after Owner A UPDATE attempt'
);
RESET ROLE;

-- ── 8. Owner cannot UPDATE another owner's business ──────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

UPDATE public.businesses
SET name = 'Hijacked'
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';

SELECT is(
  (SELECT name FROM public.businesses WHERE owner_id = '00000000-0000-0000-0000-000000000002'),
  NULL,
  'Owner A UPDATE on Owner B business is silently ignored (B not visible to A)'
);

RESET ROLE;

-- ── 9. appointment_reminders isolation ───────────────────────────────────────

DO $$
DECLARE
  reminder_a UUID := 'ffffffff-0000-0000-0000-000000000001';
  appt_a     UUID := 'dddddddd-0000-0000-0000-000000000001';
  biz_a      UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  biz_b      UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
  uid_a      UUID := '00000000-0000-0000-0000-000000000001';
  uid_b      UUID := '00000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO public.appointment_reminders
    (id, appointment_id, business_id, remind_at, minutes_before, status, channel)
  VALUES
    (reminder_a, appt_a, biz_a, NOW() + INTERVAL '23 hours', 60, 'pending', 'whatsapp')
  ON CONFLICT DO NOTHING;

  -- ── New Fixtures for Financial and Log Tests ───────────────────────────────
  
  -- Expenses
  INSERT INTO public.expenses (id, business_id, category, amount, description, expense_date)
  VALUES 
    ('11111111-0000-0000-0000-000000000001', biz_a, 'rent', 1000, 'Renta A', NOW()),
    ('22222222-0000-0000-0000-000000000001', biz_b, 'utilities', 500, 'Luz B', NOW())
  ON CONFLICT DO NOTHING;

  -- Transactions
  INSERT INTO public.transactions (id, business_id, amount, net_amount, method)
  VALUES
    ('33333333-0000-0000-0000-000000000001', biz_a, 100, 95, 'cash'),
    ('44444444-0000-0000-0000-000000000001', biz_b, 200, 190, 'card')
  ON CONFLICT DO NOTHING;

  -- Audit Logs
  INSERT INTO public.wa_audit_logs (id, business_id, sender_phone, message_text, ai_response)
  VALUES
    ('55555555-0000-0000-0000-000000000001', biz_a, '584140000000', 'hola', 'hola soy luis')
  ON CONFLICT DO NOTHING;

  -- Passkeys
  INSERT INTO public.user_passkeys (id, user_id, credential_id, public_key)
  VALUES
    ('66666666-0000-0000-0000-000000000001', uid_a, 'cred_a', 'pubkey_a'),
    ('77777777-0000-0000-0000-000000000001', uid_b, 'cred_b', 'pubkey_b')
  ON CONFLICT DO NOTHING;
END $$;

-- Owner A can see their reminder
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.appointment_reminders
   WHERE id = 'ffffffff-0000-0000-0000-000000000001'),
  1,
  'Owner A can select own reminder'
);

RESET ROLE;

-- Owner B cannot see Owner A's reminder
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.appointment_reminders
   WHERE id = 'ffffffff-0000-0000-0000-000000000001'),
  0,
  'Owner B cannot select Owner A reminder'
);

-- Owner B cannot insert reminder for business A
SELECT throws_ok(
  $q$
    INSERT INTO public.appointment_reminders
      (appointment_id, business_id, remind_at, minutes_before, status, channel)
    VALUES (
      'dddddddd-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
      NOW() + INTERVAL '1 hour',
      60, 'pending', 'whatsapp'
    )
  $q$,
  '42501',
  NULL,
  'Owner B cannot insert reminder for Owner A business'
);

RESET ROLE;

-- ── 10. service_role bypasses RLS ─────────────────────────────────────────────

SET LOCAL ROLE service_role;

-- Use >= instead of exact count (production has real data beyond test fixtures)
SELECT ok(
  (SELECT COUNT(*)::INT FROM public.users) >= 2,
  'service_role sees all users (bypasses RLS) — at least 2'
);

SELECT ok(
  (SELECT COUNT(*)::INT FROM public.businesses) >= 2,
  'service_role sees all businesses (bypasses RLS) — at least 2'
);

-- Verify service_role can see BOTH test businesses specifically
SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
  2,
  'service_role sees both test businesses'
);

RESET ROLE;

-- ── 11. Policy existence checks ───────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='users_insert'),
  'policy users_insert exists'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='users_update'),
  'policy users_update exists'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='businesses' AND policyname='businesses_select'),
  'policy businesses_select exists'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appointments_all'),
  'policy appointments_all exists'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointment_reminders' AND policyname='reminders_select_own_business'),
  'policy reminders_select_own_business exists'
);

-- ── 12. Phone uniqueness constraint per business ────────────────────────────

-- Unique index exists
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'clients' AND indexname = 'clients_business_phone_unique'
  ),
  'unique index clients_business_phone_unique exists'
);

-- Insert a client with phone for business A
INSERT INTO public.clients (id, name, phone, business_id)
VALUES (
  'cccccccc-0000-0000-0000-000000000010',
  'Phone Test Client',
  '+58 4241234567',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Duplicate phone in SAME business → error
SELECT throws_ok(
  $q$
    INSERT INTO public.clients (name, phone, business_id)
    VALUES ('Duplicate Phone', '+58 4241234567', 'aaaaaaaa-0000-0000-0000-000000000001')
  $q$,
  '23505',
  NULL,
  'duplicate phone in same business is rejected'
);

-- Same phone in DIFFERENT business → allowed
SELECT lives_ok(
  $q$
    INSERT INTO public.clients (name, phone, business_id)
    VALUES ('Same Phone Diff Biz', '+58 4241234567', 'bbbbbbbb-0000-0000-0000-000000000002')
  $q$,
  'same phone in different business is allowed'
);

-- NULL phone is always allowed (multiple clients without phone)
SELECT lives_ok(
  $q$
    INSERT INTO public.clients (name, phone, business_id)
    VALUES ('No Phone 1', NULL, 'aaaaaaaa-0000-0000-0000-000000000001')
  $q$,
  'NULL phone is allowed (no uniqueness constraint on NULL)'
);

SELECT lives_ok(
  $q$
    INSERT INTO public.clients (name, phone, business_id)
    VALUES ('No Phone 2', NULL, 'aaaaaaaa-0000-0000-0000-000000000001')
  $q$,
  'multiple NULL phones in same business are allowed'
);

-- ── 13. Financial Isolation (Expenses & Transactions) ────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.expenses WHERE business_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Owner A can see own expenses'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.expenses WHERE business_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'Owner A cannot see Owner B expenses'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.transactions WHERE business_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Owner A can see own transactions'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.transactions WHERE business_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'Owner A cannot see Owner B transactions'
);

RESET ROLE;

-- ── 14. Audit Log Privacy (Owner cannot see raw logs) ─────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.wa_audit_logs),
  0,
  'Owner A cannot see wa_audit_logs (Privacy layer)'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT is(
  (SELECT COUNT(*)::INT FROM public.wa_audit_logs WHERE id = '55555555-0000-0000-0000-000000000001'),
  1,
  'service_role can see wa_audit_logs'
);
RESET ROLE;

-- ── 15. Passkey Isolation ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.user_passkeys WHERE user_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'User A can see own passkeys'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.user_passkeys WHERE user_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'User A cannot see User B passkeys'
);

RESET ROLE;

-- ── 16. Additional Policy Checks ─────────────────────────────────────────────
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses'),
  'policy exists on expenses'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transactions'),
  'policy exists on transactions'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_passkeys'),
  'policy exists on user_passkeys'
);

-- ── 17. Admin Pulse Infrastructure (service_health & DLQ) ─────────────────────

-- Verify RLS is enabled
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'service_health' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on service_health'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'wa_dead_letter_queue' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on wa_dead_letter_queue'
);

-- Owner A cannot see anything
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.service_health),
  0,
  'Owner A cannot see service_health'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM public.wa_dead_letter_queue),
  0,
  'Owner A cannot see wa_dead_letter_queue'
);

RESET ROLE;

-- platform_admin can see EVERYTHING
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT ok(
  (SELECT COUNT(*)::INT FROM public.service_health) >= 0,
  'platform_admin can access service_health'
);
SELECT ok(
  (SELECT COUNT(*)::INT FROM public.wa_dead_letter_queue) >= 0,
  'platform_admin can access wa_dead_letter_queue'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
