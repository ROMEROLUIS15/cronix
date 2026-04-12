-- 20260412000004_cron_optimization.sql
-- FASE 2: Push timezone filter into DB for cron-reminders.
-- BEFORE: Fetch ALL businesses, filter in JS (O(n) network + memory)
-- AFTER:  DB returns only businesses where current local hour = p_hour

CREATE OR REPLACE FUNCTION public.fn_get_businesses_at_hour(
    p_hour int  -- e.g. 20 for 8 PM
)
RETURNS TABLE (
    id        uuid,
    name      text,
    timezone  text,
    settings  jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
    SELECT b.id, b.name, b.timezone, b.settings
    FROM public.businesses b
    WHERE EXTRACT(HOUR FROM NOW() AT TIME ZONE b.timezone) = p_hour;
$$;
