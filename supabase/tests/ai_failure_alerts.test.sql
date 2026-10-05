-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP Tests: AI agent per-business failure alert (observability Paso 2)
-- Run via: supabase test db
--
-- Covers fn_claim_ai_failure_alerts() over ai_traces:
--   1. Object existence + grants (service_role only)
--   2. AC-1  benign signals only        → no claim
--   3. AC-2  3 real failures, 1 business → exactly 1 claim, failure_count 3
--            (column / tool_calls / prefixed code; one trace counts once)
--   4. AC-3  immediate re-run            → cooldown, no second claim
--   5. Isolation: 2 failures in each of two businesses → no claim
--   6. Window: failures older than 10 min are ignored
--
-- Everything runs in one transaction (now() is frozen), so "older than the
-- window" fixtures set created_at explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(14);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  biz_a   UUID := 'bbbbbbbb-1111-1111-1111-111111111111';
  owner_a UUID := 'bbbbbbbb-2222-2222-2222-222222222222';
  biz_b   UUID := 'cccccccc-1111-1111-1111-111111111111';
  owner_b UUID := 'cccccccc-2222-2222-2222-222222222222';
BEGIN
  INSERT INTO public.businesses (id, name, owner_id, category, subscription_ends_at)
  VALUES (biz_a, 'Failure Alert Biz A', owner_a, 'salon', NOW() + INTERVAL '30 days'),
         (biz_b, 'Failure Alert Biz B', owner_b, 'salon', NOW() + INTERVAL '30 days')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES (owner_a, 'Failure Owner A', 'failowner-a@test.com', biz_a, 'owner', true, 'active'),
         (owner_b, 'Failure Owner B', 'failowner-b@test.com', biz_b, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;

  DELETE FROM public.ai_failure_alerts;
  DELETE FROM public.ai_traces;
END $$;

-- ── 1. Object existence + grants ─────────────────────────────────────────────
SELECT ok(
  EXISTS(SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ai_failure_alerts'),
  'ai_failure_alerts table exists'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_claim_ai_failure_alerts'),
  'fn_claim_ai_failure_alerts function exists'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_claim_ai_failure_alerts()', 'EXECUTE'),
  'authenticated cannot EXECUTE fn_claim_ai_failure_alerts'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.fn_claim_ai_failure_alerts()', 'EXECUTE'),
  'anon cannot EXECUTE fn_claim_ai_failure_alerts'
);

SELECT ok(
  has_function_privilege('service_role', 'public.fn_claim_ai_failure_alerts()', 'EXECUTE'),
  'service_role can EXECUTE fn_claim_ai_failure_alerts'
);

-- ── 2. AC-1: benign signals only → no claim ──────────────────────────────────
-- Each benign kind is inserted THRESHOLD (3) times, so wrongly counting any
-- single one of them would reach the threshold on its own and fire.
INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code, tool_calls)
SELECT b.business_id, b.channel, b.actor_kind, b.actor_key, 'sha', b.outcome, b.error_code, b.tool_calls::jsonb
FROM (VALUES
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'no_action', 'STT_NOISE', '[]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'failure', NULL,
     '[{"tool":"x","errorCode":"GUARD_REJECTED"}]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'failure', NULL,
     '[{"tool":"x","errorCode":"REVIEWER_BLOCKED"}]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'rate_limited', 'RATE_LIMITED', '[]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'whatsapp', 'client_phone', 'p', 'rate_limited', 'BOOKING_RATE_LIMIT: límite', '[]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'whatsapp', 'client_phone', 'p', 'failure', NULL,
     '[{"tool":"book","errorCode":"SLOT_CONFLICT: ocupado"}]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'failure', NULL,
     '[{"tool":"x","errorCode":"FAST_PATH_FAILURE"}]'),
  ('bbbbbbbb-1111-1111-1111-111111111111'::uuid, 'voice-worker', 'user', 'u', 'success', NULL,
     '[{"tool":"x","errorCode":"TOOL_FAILURE"}]')
) AS b(business_id, channel, actor_kind, actor_key, outcome, error_code, tool_calls)
CROSS JOIN generate_series(1, 3);

SELECT is(
  (SELECT count(*)::int FROM public.fn_claim_ai_failure_alerts()),
  0,
  'AC-1: benign signals (STT_NOISE, guards, rate limits, business outcomes) never fire'
);

-- ── 3. AC-2: 3 real failures in one business → exactly one claim ─────────────
DELETE FROM public.ai_traces;
INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code, tool_calls)
VALUES
  -- (1) code in the error_code column
  ('bbbbbbbb-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'failure', 'LLM_EXCEPTION', '[]'),
  -- (2) DB_ERROR inside tool_calls, two failing calls in the SAME trace → counts once
  ('bbbbbbbb-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'failure', NULL,
     '[{"toolName":"a","errorCode":"DB_ERROR"},{"toolName":"b","errorCode":"DB_ERROR"}]'),
  -- (3) WhatsApp free-form 'CODE: detail' in the column
  ('bbbbbbbb-1111-1111-1111-111111111111', 'whatsapp', 'client_phone', 'p', 'sha', 'failure',
     'TOOL_EXECUTION_ERROR: error interno al agendar', '[]');

CREATE TEMP TABLE claim_1 AS SELECT * FROM public.fn_claim_ai_failure_alerts();

SELECT is(
  (SELECT count(*)::int FROM claim_1),
  1,
  'AC-2: exactly one claim for the business over the threshold'
);

SELECT is(
  (SELECT failure_count FROM claim_1),
  3,
  'AC-2: failure_count counts traces (a trace with two failing tool calls counts once)'
);

SELECT is(
  (SELECT breakdown FROM claim_1),
  '{"LLM_EXCEPTION": 1, "DB_ERROR": 1, "TOOL_EXECUTION_ERROR": 1}'::jsonb,
  'AC-2: breakdown lists failing traces per normalized code'
);

SELECT is(
  (SELECT count(*)::int FROM public.ai_failure_alerts
    WHERE business_id = 'bbbbbbbb-1111-1111-1111-111111111111' AND window_min = 10),
  1,
  'AC-2: the claim is persisted in ai_failure_alerts (cooldown + audit)'
);

-- ── 4. AC-3: cooldown ────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.fn_claim_ai_failure_alerts()),
  0,
  'AC-3: second run inside the cooldown claims nothing'
);

-- ── 5. Isolation: 2 failures in each of two businesses → no claim ────────────
DELETE FROM public.ai_failure_alerts;
DELETE FROM public.ai_traces;
INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code)
VALUES
  ('bbbbbbbb-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'error', 'LLM_EXCEPTION'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'error', 'LLM_EXCEPTION'),
  ('cccccccc-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'error', 'LLM_EXCEPTION'),
  ('cccccccc-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'error', 'LLM_EXCEPTION');

SELECT is(
  (SELECT count(*)::int FROM public.fn_claim_ai_failure_alerts()),
  0,
  'isolation: failures are never pooled across businesses (2 + 2 < threshold each)'
);

-- ── 6. Window: failures older than 10 min are ignored ────────────────────────
DELETE FROM public.ai_traces;
INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome, error_code, created_at)
SELECT 'bbbbbbbb-1111-1111-1111-111111111111', 'voice-worker', 'user', 'u', 'sha', 'error', 'LLM_EXCEPTION',
       now() - interval '11 minutes'
FROM generate_series(1, 5);

SELECT is(
  (SELECT count(*)::int FROM public.fn_claim_ai_failure_alerts()),
  0,
  'window: 5 failures older than 10 minutes are ignored'
);

-- outcome = 'error' with no code still counts (key outcome:error).
DELETE FROM public.ai_traces;
INSERT INTO public.ai_traces (business_id, channel, actor_kind, actor_key, query_sha, outcome)
SELECT 'bbbbbbbb-1111-1111-1111-111111111111', 'whatsapp', 'client_phone', 'p', 'sha', 'error'
FROM generate_series(1, 3);

SELECT is(
  (SELECT breakdown FROM public.fn_claim_ai_failure_alerts()),
  '{"outcome:error": 3}'::jsonb,
  'outcome=error without a code is a failure, keyed outcome:error'
);

SELECT * FROM finish();

ROLLBACK;
