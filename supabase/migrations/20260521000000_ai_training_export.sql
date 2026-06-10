-- ─────────────────────────────────────────────────────────────────────────────
-- ai_training_exports — Daily structural training-data snapshot (Fase 5.b).
--
-- Diseño:
--   • Append-only. Cada noche, un cron por negocio inserta UN row con N samples
--     del último día agrupados como JSONL inline (jsonb).
--   • SIN texto crudo (ai_traces ya es PII-safe). Solo señales estructurales:
--     outcome, tool_sequence, error_code, latency_ms, tokens, intent.
--   • Para DPO de verdad hace falta texto + opt-in. Esto es el cimiento.
--
-- Cron + Edge Function:
--   • pg_cron dispara `export-ai-traces` diariamente a las 03:00 UTC.
--   • La Edge Function itera negocios y llama a la RPC `ai_traces_sample_window`.
--   • Inserción atómica con service_role.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_training_exports (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid         NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  range_start   timestamptz  NOT NULL,
  range_end     timestamptz  NOT NULL,
  sample_count  integer      NOT NULL CHECK (sample_count >= 0),
  jsonl         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  schema_version text        NOT NULL DEFAULT 'v1',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_window CHECK (range_end > range_start)
);

COMMENT ON TABLE  public.ai_training_exports IS 'Daily anonymized structural snapshot of ai_traces for offline eval/training prep.';
COMMENT ON COLUMN public.ai_training_exports.jsonl IS 'Array of sample objects. One per turn. No PII.';
COMMENT ON COLUMN public.ai_training_exports.schema_version IS 'Version of the JSONL row schema. Bump on breaking changes.';

CREATE INDEX IF NOT EXISTS idx_ai_training_exports_business_time
  ON public.ai_training_exports (business_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_training_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_training_exports_tenant_select
  ON public.ai_training_exports FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY ai_training_exports_service_insert
  ON public.ai_training_exports FOR INSERT TO service_role
  WITH CHECK (true);

-- ─── Sample RPC: anonymized rows from ai_traces for a time window ────────────
-- Returns the raw structural signals; bucketing/aggregation happens in app-layer
-- (TrainingExporter.ts) so threshold tweaks don't require migrations.

CREATE OR REPLACE FUNCTION public.ai_traces_sample_window(
  p_business_id  uuid,
  p_range_start  timestamptz,
  p_range_end    timestamptz,
  p_limit        integer DEFAULT 500
)
RETURNS TABLE (
  trace_id      uuid,
  created_at    timestamptz,
  channel       text,
  outcome       text,
  error_code    text,
  total_tokens  integer,
  latency_ms    integer,
  steps_count   integer,
  tools_count   integer,
  tool_sequence text[],
  intent        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.created_at,
    t.channel,
    t.outcome,
    t.error_code,
    t.total_tokens,
    t.latency_ms,
    t.steps_count,
    t.tools_count,
    COALESCE(
      ARRAY(
        SELECT call->>'tool'
        FROM jsonb_array_elements(t.tool_calls) AS call
        WHERE call ? 'tool'
      ),
      ARRAY[]::text[]
    ) AS tool_sequence,
    t.metadata->>'intent' AS intent
  FROM public.ai_traces AS t
  WHERE t.business_id = p_business_id
    AND t.created_at >= p_range_start
    AND t.created_at <  p_range_end
  ORDER BY t.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.ai_traces_sample_window(uuid, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_traces_sample_window(uuid, timestamptz, timestamptz, integer) TO service_role;

-- ─── pg_cron schedule (idempotent — unschedule then schedule) ────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-training-export-daily') THEN
    PERFORM cron.unschedule('ai-training-export-daily');
  END IF;
END
$$;

SELECT cron.schedule(
  'ai-training-export-daily',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://psuthbtdvprojdbsimvq.supabase.co/functions/v1/export-ai-traces',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
      ),
      body := '{}'
    ) AS request_id;
  $$
);
