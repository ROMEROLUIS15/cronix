-- 20260329100000_wa_rate_limiting.sql
-- Native PostgreSQL rate limiting for WhatsApp webhook (zero cost on Supabase).
--
-- Strategy: sliding-window counter per sender_phone with atomic UPSERT.
-- The function returns TRUE if the message is allowed, FALSE if rate-limited.
-- Old windows are garbage-collected inline (no cron job needed).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Rate limit counter table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wa_rate_limits (
    sender_phone  text        PRIMARY KEY,
    window_start  timestamptz NOT NULL DEFAULT now(),
    message_count int         NOT NULL DEFAULT 1
);
COMMENT ON TABLE public.wa_rate_limits IS
  'Sliding-window rate limiter for WhatsApp messages. One row per sender.';
-- RLS: only service_role accesses this table (Edge Functions use service_role_key)
ALTER TABLE public.wa_rate_limits ENABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic rate-check function
--
-- Called once per incoming message. Returns:
--   TRUE  → message allowed (counter incremented)
--   FALSE → rate limited (counter NOT incremented, message should be dropped)
--
-- Parameters:
--   p_sender      — WhatsApp phone number (e.g. '584247092980')
--   p_window_secs — window duration in seconds (default 60 = 1 minute)
--   p_max_msgs    — max messages per window (default 10)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_check_rate_limit(
    p_sender      text,
    p_window_secs int DEFAULT 60,
    p_max_msgs    int DEFAULT 10
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
    INSERT INTO wa_rate_limits (sender_phone, window_start, message_count)
    VALUES (p_sender, v_now, 1)
    ON CONFLICT (sender_phone) DO UPDATE
    SET
        -- If the current window has expired, reset; otherwise increment
        window_start  = CASE
            WHEN wa_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE wa_rate_limits.window_start
        END,
        message_count = CASE
            WHEN wa_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1  -- new window
            ELSE wa_rate_limits.message_count + 1
        END
    RETURNING window_start, message_count INTO v_window_start, v_count;

    -- Return whether this message is within the limit
    RETURN v_count <= p_max_msgs;
END;
$$;
COMMENT ON FUNCTION public.fn_wa_check_rate_limit IS
  'Atomic sliding-window rate limiter. Returns TRUE if allowed, FALSE if limited.';
-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Garbage collection: purge stale windows older than 1 hour
--    Called opportunistically — not critical, just keeps the table small.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_gc_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM wa_rate_limits
    WHERE window_start < now() - interval '1 hour';
$$;
