-- ─────────────────────────────────────────────────────────────────────────────
-- ai_traces — One row per agent turn. Richer superset of ai_tool_audit_log.
--
-- Stored fields:
--   • scope            (business_id, channel, actor_kind, actor_key)
--   • aggregates       (total_tokens, latency_ms, steps_count, tools_count)
--   • outcome          (success | failure | no_action | rate_limited | error)
--   • llm_steps jsonb  → [{ model, latency_ms, tokens, had_tool_calls }, ...]
--   • tool_calls jsonb → [{ tool, duration_ms, status, args_fingerprint, error_code }, ...]
--   • PII-safe         (only short SHAs of query/response, never the text)
--
-- This complements ai_tool_audit_log (kept intact) — same tool calls land in
-- both tables for now. ai_tool_audit_log is per-tool-call; ai_traces is per-turn.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_traces (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  business_id     uuid         NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel         text         NOT NULL CHECK (channel IN ('whatsapp', 'dashboard', 'voice-worker')),
  actor_kind      text         NOT NULL CHECK (actor_kind IN ('user', 'client_phone')),
  actor_key       text         NOT NULL,
  query_sha       text         NOT NULL,
  outcome         text         NOT NULL CHECK (outcome IN ('success', 'failure', 'no_action', 'rate_limited', 'error')),
  error_code      text         NULL,
  final_text_sha  text         NULL,
  total_tokens    integer      NOT NULL DEFAULT 0,
  latency_ms      integer      NOT NULL DEFAULT 0,
  steps_count     integer      NOT NULL DEFAULT 0,
  tools_count     integer      NOT NULL DEFAULT 0,
  llm_steps       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  tool_calls      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE  public.ai_traces IS 'Per-turn observability trace. Aggregates LLM steps + tool calls. PII-safe (SHAs only).';
COMMENT ON COLUMN public.ai_traces.query_sha      IS 'SHA-256 (first 16 hex) of the user query. Correlation without PII.';
COMMENT ON COLUMN public.ai_traces.final_text_sha IS 'SHA-256 (first 16 hex) of the assistant final response.';

CREATE INDEX IF NOT EXISTS idx_ai_traces_business_time
  ON public.ai_traces (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_traces_outcome
  ON public.ai_traces (business_id, outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_traces_channel
  ON public.ai_traces (business_id, channel, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_traces_tenant_select
  ON public.ai_traces FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- service_role bypasses RLS implicitly. INSERT policy is left open to service
-- role only as defense in depth.
CREATE POLICY ai_traces_service_insert
  ON public.ai_traces FOR INSERT TO service_role
  WITH CHECK (true);

-- ─── Aggregation RPC for the future dashboard (kept minimal) ─────────────────
CREATE OR REPLACE FUNCTION public.ai_traces_summary_24h(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',     count(*),
    'success',   count(*) FILTER (WHERE outcome = 'success'),
    'failures',  count(*) FILTER (WHERE outcome IN ('failure', 'error', 'rate_limited')),
    'no_action', count(*) FILTER (WHERE outcome = 'no_action'),
    'tokens',    COALESCE(sum(total_tokens), 0),
    'p50_ms',    COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms), 0),
    'p95_ms',    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)
  )
  FROM public.ai_traces
  WHERE business_id = p_business_id
    AND created_at > now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.ai_traces_summary_24h(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_traces_summary_24h(uuid) TO authenticated, service_role;
