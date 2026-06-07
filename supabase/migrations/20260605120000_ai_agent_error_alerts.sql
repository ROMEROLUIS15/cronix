-- ─────────────────────────────────────────────────────────────────────────────
-- AI Agent error-rate alerting (Mejora 1)
--
-- The AI agent never throws on a failed turn: Tracer routes failures to
-- `outcome` in ai_traces, so Sentry never sees them. The *rate* of failed turns
-- therefore has to be computed where the data lives — here, over ai_traces —
-- and not in Sentry (Sentry has no denominator of total turns).
--
-- This migration adds:
--   • ai_agent_alerts        — audit log of every alert that fired (also the
--                              cooldown source of truth, so we never spam Slack).
--   • check_ai_agent_error_rate() — pure-SQL check over a rolling window. If the
--                              error rate exceeds the threshold (and volume is
--                              non-trivial, and we are past the cooldown) it posts
--                              to a Slack incoming webhook via pg_net.
--   • pg_cron job            — runs the check every 15 minutes.
--
-- The Slack webhook URL is read from Vault at execution time (secret
-- `slack_alerts_webhook_url`), mirroring the cron_secret pattern in
-- 20260519010000_schedule_cron_imminent_push.sql. If the secret is absent the
-- function no-ops gracefully, so this migration is safe to apply before the
-- secret is provisioned.
--
-- "Error" here = outcome IN ('failure','error'). 'rate_limited' is excluded on
-- purpose: it is a capacity signal, not an agent failure, and alerting on it
-- would be noise. Tune the constants at the top of the function as volume grows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── Audit log + cooldown source of truth ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_agent_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  window_min    integer     NOT NULL,
  total_turns   integer     NOT NULL,
  error_turns   integer     NOT NULL,
  error_rate    numeric     NOT NULL,
  breakdown     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  delivered     boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE public.ai_agent_alerts IS
  'Audit log of AI agent error-rate alerts. Cross-tenant ops data (not tenant-scoped). Also drives the alert cooldown.';

CREATE INDEX IF NOT EXISTS idx_ai_agent_alerts_created_at
  ON public.ai_agent_alerts (created_at DESC);

-- Cross-tenant aggregate → visible only to platform admins, never per-tenant owners.
ALTER TABLE public.ai_agent_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_alerts_admin_select
  ON public.ai_agent_alerts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'platform_admin'
        AND is_active = true
    )
  );

-- ─── The check ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_ai_agent_error_rate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Tunables ----------------------------------------------------------------
  c_threshold  constant numeric  := 0.05;                 -- 5% error rate
  c_min_volume constant integer  := 20;                   -- ignore small samples
  c_window     constant interval := interval '60 minutes';
  c_cooldown   constant interval := interval '60 minutes';
  -- -------------------------------------------------------------------------
  v_total      integer;
  v_errors     integer;
  v_rate       numeric;
  v_by_channel jsonb;
  v_top_errors jsonb;
  v_webhook    text;
  v_last       timestamptz;
  v_msg        text;
  v_alert_id   uuid;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE outcome IN ('failure', 'error'))
  INTO v_total, v_errors
  FROM public.ai_traces
  WHERE created_at > now() - c_window;

  -- Small-sample guard: a couple of transient errors on low traffic is noise.
  IF v_total < c_min_volume THEN RETURN; END IF;

  v_rate := v_errors::numeric / v_total;
  IF v_rate <= c_threshold THEN RETURN; END IF;

  -- Cooldown: don't re-alert while an incident is ongoing.
  SELECT max(created_at) INTO v_last FROM public.ai_agent_alerts;
  IF v_last IS NOT NULL AND v_last > now() - c_cooldown THEN RETURN; END IF;

  -- Triage context: errors per channel + top error codes.
  SELECT jsonb_object_agg(channel, cnt)
  INTO v_by_channel
  FROM (
    SELECT channel, count(*) FILTER (WHERE outcome IN ('failure', 'error')) AS cnt
    FROM public.ai_traces
    WHERE created_at > now() - c_window
    GROUP BY channel
  ) s;

  SELECT jsonb_object_agg(error_code, cnt)
  INTO v_top_errors
  FROM (
    SELECT coalesce(error_code, '(none)') AS error_code, count(*) AS cnt
    FROM public.ai_traces
    WHERE created_at > now() - c_window
      AND outcome IN ('failure', 'error')
    GROUP BY error_code
    ORDER BY count(*) DESC
    LIMIT 5
  ) e;

  INSERT INTO public.ai_agent_alerts (window_min, total_turns, error_turns, error_rate, breakdown)
  VALUES (
    60, v_total, v_errors, round(v_rate, 4),
    jsonb_build_object('by_channel', coalesce(v_by_channel, '{}'::jsonb),
                       'top_errors', coalesce(v_top_errors, '{}'::jsonb))
  )
  RETURNING id INTO v_alert_id;

  SELECT decrypted_secret INTO v_webhook
  FROM vault.decrypted_secrets
  WHERE name = 'slack_alerts_webhook_url'
  LIMIT 1;

  IF v_webhook IS NULL THEN
    RAISE NOTICE 'AI agent error rate elevated (% of % turns) but slack_alerts_webhook_url is not set in Vault',
      v_errors, v_total;
    RETURN;
  END IF;

  v_msg := format(
    E':rotating_light: *Cronix AI agent error rate %s%%* (last 60m)\n• Turns: %s   • Errors: %s\n• By channel: %s\n• Top errors: %s',
    round(v_rate * 100, 1),
    v_total,
    v_errors,
    coalesce(v_by_channel::text, '{}'),
    coalesce(v_top_errors::text, '{}')
  );

  PERFORM net.http_post(
    url     := v_webhook,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('text', v_msg)
  );

  UPDATE public.ai_agent_alerts SET delivered = true WHERE id = v_alert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_agent_error_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ai_agent_error_rate() TO service_role;

-- ─── Schedule: every 15 minutes ──────────────────────────────────────────────
DO $$ BEGIN
  PERFORM cron.unschedule('ai-agent-error-rate-check');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'ai-agent-error-rate-check',
  '*/15 * * * *',
  $job$ SELECT public.check_ai_agent_error_rate(); $job$
);
