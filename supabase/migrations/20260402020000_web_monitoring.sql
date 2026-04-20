-- 20260402020000_web_monitoring.sql
-- Monitoring View for Web Rate Limiting.
--
-- This view helps administrators identify potential brute-force or DDoS attacks.
-- It ranks identifiers (IPs/Users) by their request volume in the current window.

CREATE OR REPLACE VIEW public.v_web_suspicious_activity AS
SELECT 
    identifier,
    request_count,
    window_start,
    (window_start + interval '1 minute') > now() as is_active_window,
    CASE 
        WHEN request_count >= 5 THEN 'CRITICAL (Auth Block)'
        WHEN request_count >= 50 THEN 'WARNING (API Flood)'
        ELSE 'NORMAL'
    END as status
FROM public.web_rate_limits
WHERE window_start > now() - interval '24 hours'
ORDER BY request_count DESC;
COMMENT ON VIEW public.v_web_suspicious_activity IS
  'Real-time monitoring of rate-limited identifiers for the web platform.';
-- Helper function to clear all rate limits (Emergency reset)
CREATE OR REPLACE FUNCTION public.fn_reset_all_web_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    DELETE FROM web_rate_limits;
$$;
