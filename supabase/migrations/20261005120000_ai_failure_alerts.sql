-- ─────────────────────────────────────────────────────────────────────────────
-- AI agent per-business failure alert (observability Paso 2) → Sentry
--
-- Pushes a Sentry alert to the operator when ONE business accumulates real AI
-- agent failures in a short window. It runs alongside — and does not replace —
-- the global Slack error-rate alert from 20260605120000_ai_agent_error_alerts.sql
-- (different table, different question: "is a tenant on fire?" vs "is the error
-- rate global-high?").
--
-- Design:
--   • fn_claim_ai_failure_alerts() evaluates ai_traces, applies the per-business
--     cooldown and RETURNS the alerts it just claimed (inserting them into
--     ai_failure_alerts in the same transaction). It sends nothing itself.
--   • The Edge Function `cron-ai-alerts` calls it every 10 min (pg_cron → HTTP),
--     and forwards each claimed alert to Sentry. Sentry is the delivery channel.
--
-- "Real failure" (a trace = one agent turn, counted at most once):
--     outcome = 'error'
--  OR the normalized ai_traces.error_code column  ∈ FIRE
--  OR any ai_traces.tool_calls[].errorCode (normalized) ∈ FIRE
--   FIRE      = LLM_EXCEPTION, DB_ERROR, TOOL_EXECUTION_ERROR
--   normalize = text before the first ':' , trimmed (WhatsApp stores free-form
--               'CODE: detail' strings, e.g. 'TOOL_EXECUTION_ERROR: ...').
-- Guards (GUARD_REJECTED, REVIEWER_BLOCKED), STT_NOISE, rate limits, business
-- outcomes (SLOT_CONFLICT, ...) and generic tool failures are NOT failures.
--
-- The function never writes to ai_traces, so the alert cannot count itself.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── Audit log + cooldown source of truth ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_failure_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  window_min    integer     NOT NULL,
  failure_count integer     NOT NULL,
  breakdown     jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.ai_failure_alerts IS
  'Per-business AI failure alerts claimed by fn_claim_ai_failure_alerts(). Cooldown source of truth + audit trail. Operator data: service_role only. Separate from the global Slack alert log ai_agent_alerts.';

CREATE INDEX IF NOT EXISTS idx_ai_failure_alerts_business_time
  ON public.ai_failure_alerts (business_id, created_at DESC);

-- Operator-only data: RLS on with NO policies for anon/authenticated. service_role
-- (and SECURITY DEFINER functions owned by postgres) bypass RLS.
ALTER TABLE public.ai_failure_alerts ENABLE ROW LEVEL SECURITY;

-- ─── Time-window index on ai_traces ──────────────────────────────────────────
-- The claim scans ALL tenants by time window. Every existing ai_traces index
-- leads with business_id, so without this one each run is a full scan of a
-- table that has no retention policy and grows forever.
CREATE INDEX IF NOT EXISTS idx_ai_traces_created_at
  ON public.ai_traces (created_at DESC);

-- ─── The claim ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_claim_ai_failure_alerts()
RETURNS TABLE (business_id uuid, failure_count integer, breakdown jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  -- Tunables ----------------------------------------------------------------
  c_threshold  constant integer  := 3;                    -- failed turns per business
  c_window     constant interval := interval '10 minutes';
  c_cooldown   constant interval := interval '60 minutes';
  c_fire       constant text[]   := ARRAY['LLM_EXCEPTION', 'DB_ERROR', 'TOOL_EXECUTION_ERROR'];
  -- -------------------------------------------------------------------------
BEGIN
  -- Serialize concurrent runs so two overlapping cron ticks cannot both claim
  -- the same business (the cooldown check below would race otherwise).
  PERFORM pg_advisory_xact_lock(hashtext('fn_claim_ai_failure_alerts'));

  RETURN QUERY
  WITH classified AS (
    SELECT
      t.business_id,
      ARRAY(
        SELECT DISTINCT s.code
        FROM (
          SELECT CASE WHEN t.outcome = 'error' THEN 'outcome:error' END AS code
          UNION ALL
          SELECT btrim(split_part(t.error_code, ':', 1))
          UNION ALL
          SELECT btrim(split_part(tc ->> 'errorCode', ':', 1))
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(t.tool_calls) = 'array'
                      THEN t.tool_calls ELSE '[]'::jsonb END
               ) AS tc
        ) AS s
        WHERE s.code = 'outcome:error' OR s.code = ANY (c_fire)
      ) AS codes
    FROM public.ai_traces t
    WHERE t.created_at > now() - c_window
  ),
  failed AS (
    SELECT c.business_id, c.codes
    FROM classified c
    WHERE cardinality(c.codes) > 0
  ),
  per_business AS (
    SELECT f.business_id, count(*)::integer AS failure_count
    FROM failed f
    GROUP BY f.business_id
    HAVING count(*) >= c_threshold
       AND NOT EXISTS (
         SELECT 1
         FROM public.ai_failure_alerts a
         WHERE a.business_id = f.business_id
           AND a.created_at > now() - c_cooldown
       )
  ),
  per_code AS (
    SELECT f.business_id, u.code, count(*)::integer AS n
    FROM failed f
    CROSS JOIN LATERAL unnest(f.codes) AS u(code)
    GROUP BY f.business_id, u.code
  ),
  claimed AS (
    INSERT INTO public.ai_failure_alerts (business_id, window_min, failure_count, breakdown)
    SELECT
      pb.business_id,
      (extract(epoch FROM c_window) / 60)::integer,
      pb.failure_count,
      (SELECT jsonb_object_agg(pc.code, pc.n)
       FROM per_code pc
       WHERE pc.business_id = pb.business_id)
    FROM per_business pb
    RETURNING public.ai_failure_alerts.business_id,
              public.ai_failure_alerts.failure_count,
              public.ai_failure_alerts.breakdown
  )
  SELECT cl.business_id, cl.failure_count, cl.breakdown
  FROM claimed cl;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_ai_failure_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_ai_failure_alerts() TO service_role;

-- ─── Schedule: every 10 minutes ──────────────────────────────────────────────
-- Same pattern as 20260519010000_schedule_cron_imminent_push.sql: the CRON_SECRET
-- is read from Vault at execution time and never lives in source.
DO $$ BEGIN PERFORM cron.unschedule('cron-ai-alerts'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'cron-ai-alerts',
  '*/10 * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://psuthbtdvprojdbsimvq.supabase.co/functions/v1/cron-ai-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
          LIMIT 1
        )
      ),
      body := '{}'
    ) AS request_id;
  $job$
);
