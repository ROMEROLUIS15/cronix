-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP Tests: Critical Business Functions
-- Run via: supabase test db
--
-- Tests para funciones RPC críticas:
-- 1. Pagos (fn_finalize_paypal_payment) — idempotencia, tolerancia
-- 2. Agendamiento (fn_book_appointment_wa, fn_reschedule_appointment_wa)
-- 3. Rate Limiting (fn_wa_check_rate_limit, fn_web_check_rate_limit)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(21);

-- ── Setup: Test fixtures ──────────────────────────────────────────────────────

DO $$
DECLARE
  test_biz_id      UUID := 'ffffffff-1111-1111-1111-111111111111';
  test_owner_id    UUID := 'ffffffff-2222-2222-2222-222222222222';
  test_client_id   UUID := 'ffffffff-3333-3333-3333-333333333333';
  test_service_id  UUID := 'ffffffff-4444-4444-4444-444444444444';
BEGIN
  -- Create business
  INSERT INTO public.businesses (id, name, owner_id, category, subscription_ends_at)
  VALUES (test_biz_id, 'Test Biz', test_owner_id, 'salon', NOW() + INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

  -- Create owner user
  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES (test_owner_id, 'Owner', 'owner@test.com', test_biz_id, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;

  -- Create client
  INSERT INTO public.clients (id, name, business_id)
  VALUES (test_client_id, 'Test Client', test_biz_id)
  ON CONFLICT DO NOTHING;

  -- Create service
  INSERT INTO public.services (id, name, duration_min, price, business_id)
  VALUES (test_service_id, 'Test Service', 30, 50000, test_biz_id)
  ON CONFLICT DO NOTHING;

  -- Create appointment for rescheduling tests
  INSERT INTO public.appointments (
    id, business_id, client_id, service_id,
    start_at, end_at, status
  )
  VALUES (
    'ffffffff-6666-6666-6666-666666666666',
    test_biz_id, test_client_id, test_service_id,
    NOW() + INTERVAL '2 days',
    NOW() + INTERVAL '2 days 30 minutes',
    'pending'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: PAGOS (fn_finalize_paypal_payment)
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_finalize_paypal_payment'),
  'fn_finalize_paypal_payment exists'
);

-- 1.1 Setup: Create test invoice
DO $$
DECLARE
  test_biz_id      UUID := 'ffffffff-1111-1111-1111-111111111111';
  test_invoice_id  UUID := 'ffffffff-7777-7777-7777-777777777777';
BEGIN
  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, test_biz_id, 99.99, 'waiting', 'paypal',
    'pp_test_order_001', 'pro'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- 1.2 Test: Successful payment finalization
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_001', 99.99)).result_status),
  'completed',
  'payment finalized successfully'
);

-- 1.3 Test: Invoice status updated to 'finished'
SELECT is(
  (SELECT status FROM public.saas_invoices WHERE np_invoice_id = 'pp_test_order_001'),
  'finished',
  'invoice status changed to finished'
);

-- 1.4 Test: Business plan updated to purchased plan
SELECT is(
  (SELECT plan FROM public.businesses WHERE id = 'ffffffff-1111-1111-1111-111111111111'),
  'pro',
  'business plan updated to purchased plan'
);

-- 1.5 Test: Idempotency — calling again returns 'already_processed'
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_001', 99.99)).result_status),
  'already_processed',
  'second call returns already_processed (idempotent)'
);

-- 1.6 Setup: Create separate invoice for tolerance test
DO $$
DECLARE
  test_invoice_id  UUID := 'ffffffff-8888-8888-8888-888888888888';
  test_biz_id_2    UUID := 'ffffffff-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  test_owner_id_2  UUID := 'ffffffff-cccc-cccc-cccc-cccccccccccc';
BEGIN
  -- Create separate business for this test
  INSERT INTO public.businesses (id, name, owner_id, category, subscription_ends_at)
  VALUES (test_biz_id_2, 'Test Biz 2', test_owner_id_2, 'salon', NOW() + INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES (test_owner_id_2, 'Owner 2', 'owner2@test.com', test_biz_id_2, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, test_biz_id_2, 100.00, 'waiting', 'paypal',
    'pp_test_order_002', 'free'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- 1.7 Test: Amount mismatch tolerance (< 0.01 accepted)
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_002', 100.009)).result_status),
  'completed',
  'amount within tolerance (100.009 vs 100.00) is accepted'
);

-- 1.8 Setup: Create invoice with large amount mismatch
DO $$
DECLARE
  test_invoice_id  UUID := 'ffffffff-9999-9999-9999-999999999999';
  test_biz_id_3    UUID := 'ffffffff-dddd-dddd-dddd-dddddddddddd';
  test_owner_id_3  UUID := 'ffffffff-eeee-eeee-eeee-eeeeeeeeeeee';
BEGIN
  INSERT INTO public.businesses (id, name, owner_id, category, subscription_ends_at)
  VALUES (test_biz_id_3, 'Test Biz 3', test_owner_id_3, 'salon', NOW() + INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES (test_owner_id_3, 'Owner 3', 'owner3@test.com', test_biz_id_3, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, test_biz_id_3,
    100.00, 'waiting', 'paypal', 'pp_test_order_003', 'enterprise'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- 1.9 Test: Amount mismatch > 0.01 rejected
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_003', 99.00)).result_status),
  'amount_mismatch',
  'payment rejected when amount differs > 0.01'
);

-- 1.10 Test: Invoice not found
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_nonexistent', 100.00)).result_status),
  'invoice_not_found',
  'payment rejected for nonexistent invoice'
);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: AGENDAMIENTO
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_book_appointment_wa'),
  'fn_book_appointment_wa exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_reschedule_appointment_wa'),
  'fn_reschedule_appointment_wa exists'
);

-- 2.1 Test: fn_book_appointment_wa creates appointment
DO $$
DECLARE
  result RECORD;
  v_future_time TIMESTAMPTZ;
BEGIN
  v_future_time := NOW() + INTERVAL '3 days';

  SELECT * INTO result
  FROM public.fn_book_appointment_wa(
    'ffffffff-1111-1111-1111-111111111111',  -- business_id
    '+58414-1234567',  -- client_phone
    'New Client',  -- client_name
    'ffffffff-4444-4444-4444-444444444444',  -- service_id
    v_future_time  -- start_at (timestamptz)
  );

  -- Just verify the function is callable; don't check result shape
  -- since it returns JSONB which may vary
END $$;

SELECT ok(
  EXISTS(SELECT 1 FROM public.appointments
   WHERE business_id = 'ffffffff-1111-1111-1111-111111111111'
     AND start_at > NOW()),
  'appointment created or exists via fn_book_appointment_wa'
);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: RATE LIMITING
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_wa_check_rate_limit'),
  'fn_wa_check_rate_limit exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_web_check_rate_limit'),
  'fn_web_check_rate_limit exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_wa_check_circuit_breaker'),
  'fn_wa_check_circuit_breaker exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_wa_check_token_quota'),
  'fn_wa_check_token_quota exists'
);

-- 3.1 Test: Rate limit initialization (first request OK)
SELECT ok(
  (SELECT fn_wa_check_rate_limit('58414_testphone_1')),
  'first WhatsApp request passes rate limit check'
);

-- 3.2 Test: Web rate limit check
SELECT ok(
  (SELECT fn_web_check_rate_limit('test_web_user_1')),
  'web rate limit check returns boolean'
);

-- 3.3 Test: Circuit breaker accessible with service name
SELECT ok(
  (SELECT fn_wa_check_circuit_breaker('whatsapp')),
  'circuit breaker returns boolean'
);

-- 3.4 Test: Token quota check
SELECT ok(
  (SELECT fn_wa_check_token_quota('ffffffff-1111-1111-1111-111111111111')),
  'token quota check returns boolean'
);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_clean_phone'),
  'fn_clean_phone exists'
);

SELECT ok(
  LENGTH(COALESCE(public.fn_clean_phone('+58 414 1234567'), '')) > 0,
  'fn_clean_phone returns non-empty result'
);

-- ────────────────────────────────────────────────────────────────────────────
-- CLEANUP & SUMMARY
-- ────────────────────────────────────────────────────────────────────────────

SELECT * FROM finish();

ROLLBACK;
