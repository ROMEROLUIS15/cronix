-- 20260412000002_misc_performance_fixes.sql
-- FASE 1: Remaining quick-win fixes that don't fit in other migrations.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX: v_web_suspicious_activity threshold inversion
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG: >= 50 checked before >= 5, so count=100 → "WARNING" instead of "CRITICAL"
-- FIX: Check most severe threshold first (>= 5 → CRITICAL), then >= 50 → SEVERE

DROP VIEW IF EXISTS public.v_web_suspicious_activity;
CREATE VIEW public.v_web_suspicious_activity
  WITH (security_invoker = true)
AS
 SELECT identifier,
    request_count,
    window_start,
    ((window_start + '00:01:00'::interval) > now()) AS is_active_window,
        CASE
            WHEN (request_count >= 5)  THEN 'CRITICAL (Auth Block)'::text
            WHEN (request_count >= 50) THEN 'SEVERE (API Flood)'::text
            ELSE 'NORMAL'::text
        END AS status
   FROM public.web_rate_limits
  WHERE (window_start > (now() - '24:00:00'::interval))
  ORDER BY request_count DESC;
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIX: fn_wa_report_service_failure — UPSERT to eliminate TOCTOU race
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE: UPDATE that silently fails (0 rows) if row doesn't exist
-- AFTER:  INSERT ... ON CONFLICT — idempotent under concurrency

CREATE OR REPLACE FUNCTION public.fn_wa_report_service_failure(
    p_service_name text,
    p_threshold    int DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    INSERT INTO public.service_health (service_name, failure_count, last_failure, status)
    VALUES (p_service_name, 1, now(), 'CLOSED')
    ON CONFLICT (service_name) DO UPDATE SET
        failure_count = public.service_health.failure_count + 1,
        last_failure  = now(),
        status        = CASE
            WHEN public.service_health.failure_count + 1 >= p_threshold THEN 'OPEN'
            ELSE public.service_health.status
        END;
END;
$$;
-- Also fix fn_wa_report_service_success for consistency (UPSERT pattern)
CREATE OR REPLACE FUNCTION public.fn_wa_report_service_success(
    p_service_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    INSERT INTO public.service_health (service_name, failure_count, status)
    VALUES (p_service_name, 0, 'CLOSED')
    ON CONFLICT (service_name) DO UPDATE SET
        failure_count = 0,
        status        = 'CLOSED';
END;
$$;
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ADD: CHECK constraint end_at > start_at on appointments
-- ─────────────────────────────────────────────────────────────────────────────
-- Prevents inserting appointments where end <= start (invalid scheduling data)

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.appointments WHERE end_at <= start_at
    ) THEN
        RAISE WARNING 'Existing appointments violate end_at > start_at — constraint NOT added. Fix data first.';
    ELSE
        ALTER TABLE public.appointments
            ADD CONSTRAINT chk_appointment_time_order CHECK (end_at > start_at);
    END IF;
END $$;
