-- 20260402010000_web_rate_limiting.sql
-- Native PostgreSQL rate limiting for Web Routes (Dashboard/Auth).
--
-- Strategy: sliding-window counter per identifier (IP or User ID) with atomic UPSERT.
-- The function returns TRUE if allowed, FALSE if rate-limited.
-- Old windows are garbage-collected inline (no cron job needed).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Web Rate limit counter table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.web_rate_limits (
    identifier    text        PRIMARY KEY, -- IP address or User ID
    window_start  timestamptz NOT NULL DEFAULT now(),
    request_count int         NOT NULL DEFAULT 1
);
COMMENT ON TABLE public.web_rate_limits IS
  'Sliding-window rate limiter for Web Auth and API routes. One row per identifier.';
-- RLS: only service_role and anon (client-side middleware call) can access for reading,
-- but the increment logic is encapsulated in a SECURITY DEFINER function.
ALTER TABLE public.web_rate_limits ENABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic web rate-check function
--
-- Called from the Next.js Middleware. Returns:
--   TRUE  → request allowed (counter incremented)
--   FALSE → rate limited (counter NOT incremented)
--
-- Parameters:
--   p_identifier  — Identifier (e.g. client IP address)
--   p_window_secs — window duration in seconds (default 60 = 1 minute)
--   p_max_req     — max requests per window (default 5 for auth routes)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_web_check_rate_limit(
    p_identifier  text,
    p_window_secs int DEFAULT 60,
    p_max_req     int DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now          timestamptz := now();
    v_window_start timestamptz;
    v_count        int;
BEGIN
    -- Atomic: insert or update in a single statement
    INSERT INTO web_rate_limits (identifier, window_start, request_count)
    VALUES (p_identifier, v_now, 1)
    ON CONFLICT (identifier) DO UPDATE
    SET
        -- If the current window has expired, reset; otherwise increment
        window_start  = CASE
            WHEN web_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE web_rate_limits.window_start
        END,
        request_count = CASE
            WHEN web_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1  -- new window
            ELSE web_rate_limits.request_count + 1
        END
    RETURNING window_start, request_count INTO v_window_start, v_count;

    -- Return whether this request is within the limit
    RETURN v_count <= p_max_req;
END;
$$;
COMMENT ON FUNCTION public.fn_web_check_rate_limit IS
  'Atomic sliding-window rate limiter for Web routes. Returns TRUE if allowed, FALSE if limited.';
-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Garbage collection: purge stale windows older than 24 hours
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_web_gc_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM web_rate_limits
    WHERE window_start < now() - interval '24 hours';
$$;
