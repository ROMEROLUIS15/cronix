-- ─────────────────────────────────────────────────────────────────────────────
-- Fix SECURITY DEFINER on v_web_suspicious_activity
-- Goal: Use SECURITY INVOKER (default in PG15+ with proper syntax) to 
-- ensure the view doesn't escalate privileges.
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_web_suspicious_activity;

CREATE VIEW public.v_web_suspicious_activity
  WITH (security_invoker = true)
AS
 SELECT identifier,
    request_count,
    window_start,
    ((window_start + '00:01:00'::interval) > now()) AS is_active_window,
        CASE
            WHEN (request_count >= 50) THEN 'WARNING (API Flood)'::text
            WHEN (request_count >= 5) THEN 'CRITICAL (Auth Block)'::text
            ELSE 'NORMAL'::text
        END AS status
   FROM public.web_rate_limits
  WHERE (window_start > (now() - '24:00:00'::interval))
  ORDER BY request_count DESC;

-- Revoke all from public and grant only to authenticated/service_role if needed
-- Actually, with security_invoker = true, if RLS is enabled on web_rate_limits (which we just did),
-- an ordinary user will see 0 rows unless they have permission on the base table.
-- This is exactly what we want.
