CREATE OR REPLACE FUNCTION public.fn_get_businesses_at_hour(
    p_hour int
)
RETURNS TABLE (
    id        uuid,
    name      text,
    timezone  text,
    phone     text,
    settings  jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
    SELECT b.id, b.name, b.timezone, b.phone, b.settings
    FROM public.businesses b
    WHERE EXTRACT(HOUR FROM NOW() AT TIME ZONE b.timezone) = p_hour;
$$;;
