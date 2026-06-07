-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP Tests: AI Agent error-rate alerting
-- Run via: supabase test db
--
-- Covers check_ai_agent_error_rate() over ai_traces:
--   1. Object existence (table + function)
--   2. Small-sample guard      → no alert below min volume
--   3. Below threshold         → no alert
--   4. Above threshold         → exactly one alert, fields correct
--   5. Cooldown                → no duplicate alert on immediate re-run
--
-- With no Vault secret 'slack_alerts_webhook_url' present (the case in the test
-- DB) the function logs a NOTICE and returns after writing the audit row, so the
-- Slack/network path is never exercised here — we assert on ai_agent_alerts.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(9);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  test_biz_id   UUID := 'aaaaaaaa-1111-1111-1111-111111111111';
  test_owner_id UUID := 'aaaaaaaa-2222-2222-2222-222222222222';
BEGIN
  INSERT INTO public.businesses (id, name, owner_id, category, subscription_ends_at)
  VALUES (test_biz_id, 'Alert Test Biz', test_owner_id, 'salon', NOW() + INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES (test_owner_id, 'Alert Owner', 'alertowner@test.com', test_biz_id, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;

  -- Deterministic counts: the function aggregates the whole table.
  DELETE FROM public.ai_agent_alerts;
  DELETE FROM public.ai_traces;
END $$;

-- ── 1. Object existence ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS(SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ai_agent_alerts'),
  'ai_agent_alerts table exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'check_ai_agent_error_rate'),
  'check_ai_agent_error_rate function exists'
);

-- Helper to insert N traces with a given outcome in the current window.
-- (Inlined per scenario below via generate_series.)

-- ── 2. Small-sample guard: 5 errors only (< min volume 20) → no alert ────────
DO $$
DECLARE test_biz_id UUID := 'aaaaaaaa-1111-1111-1111-111111111111';
BEGIN
  DELETE FROM public.ai_traces;
  INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code)
  SELECT test_biz_id, 'whatsapp', 'client_phone', 'tester', 'sha', 'error', 'BOOM'
  FROM generate_series(1, 5);
  PERFORM public.check_ai_agent_error_rate();
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.ai_agent_alerts),
  0,
  'no alert fired below minimum volume (5 turns)'
);

-- ── 3. Below threshold: 30 success + 1 error (3.2%) → no alert ───────────────
DO $$
DECLARE test_biz_id UUID := 'aaaaaaaa-1111-1111-1111-111111111111';
BEGIN
  DELETE FROM public.ai_traces;
  INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome)
  SELECT test_biz_id, 'whatsapp', 'client_phone', 'tester', 'sha', 'success'
  FROM generate_series(1, 30);
  INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code)
  VALUES (test_biz_id, 'whatsapp', 'client_phone', 'tester', 'sha', 'error', 'BOOM');
  PERFORM public.check_ai_agent_error_rate();
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.ai_agent_alerts),
  0,
  'no alert fired below 5% threshold (1/31 = 3.2%)'
);

-- ── 4. Above threshold: 30 success + 5 error (14.3%) → exactly one alert ─────
DO $$
DECLARE test_biz_id UUID := 'aaaaaaaa-1111-1111-1111-111111111111';
BEGIN
  DELETE FROM public.ai_traces;
  INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome)
  SELECT test_biz_id, 'whatsapp', 'client_phone', 'tester', 'sha', 'success'
  FROM generate_series(1, 30);
  INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code)
  SELECT test_biz_id, 'whatsapp', 'client_phone', 'tester', 'sha', 'error', 'BOOM'
  FROM generate_series(1, 5);
  PERFORM public.check_ai_agent_error_rate();
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.ai_agent_alerts),
  1,
  'alert fired above 5% threshold (5/35 = 14.3%)'
);

SELECT is(
  (SELECT error_turns FROM public.ai_agent_alerts ORDER BY created_at DESC LIMIT 1),
  5,
  'alert records correct error_turns'
);

SELECT is(
  (SELECT total_turns FROM public.ai_agent_alerts ORDER BY created_at DESC LIMIT 1),
  35,
  'alert records correct total_turns'
);

SELECT is(
  (SELECT delivered FROM public.ai_agent_alerts ORDER BY created_at DESC LIMIT 1),
  false,
  'alert not marked delivered when no Slack webhook is configured'
);

-- ── 5. Cooldown: immediate re-run does not duplicate the alert ──────────────
DO $$
BEGIN
  PERFORM public.check_ai_agent_error_rate();
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.ai_agent_alerts),
  1,
  'cooldown suppresses a duplicate alert on immediate re-run'
);

SELECT * FROM finish();

ROLLBACK;
