-- 20260402000000_wa_business_usage.sql
-- Native PostgreSQL rate limiting for WhatsApp Business Quota (Multi-tenancy protection).
--
-- Strategy: sliding-window counter per business_id with atomic UPSERT.
-- The function returns TRUE if the message is allowed, FALSE if business quota is exceeded.
-- This protects the platform against a single business exhausting LLM/DB resources.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Business Usage counter table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wa_business_usage (
    business_id   uuid        PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    window_start  timestamptz NOT NULL DEFAULT now(),
    message_count int         NOT NULL DEFAULT 1
);

COMMENT ON TABLE public.wa_business_usage IS
  'Anti-spam / Cost Control: tracks aggregate WhatsApp messages per business within a sliding window.';

-- RLS: only service_role accesses this table (Edge Functions use service_role_key)
ALTER TABLE public.wa_business_usage ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic business rate-check function
--
-- Called once per incoming message after business resolution. Returns:
--   TRUE  → quota allowed (counter incremented)
--   FALSE → quota exceeded (counter NOT incremented, message should be dropped)
--
-- Parameters:
--   p_business_id — target business UUID
--   p_window_secs — window duration in seconds (default 60 = 1 minute)
--   p_max_msgs    — max messages per window (default 50)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_check_business_limit(
    p_business_id uuid,
    p_window_secs int DEFAULT 60,
    p_max_msgs    int DEFAULT 50
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
    INSERT INTO wa_business_usage (business_id, window_start, message_count)
    VALUES (p_business_id, v_now, 1)
    ON CONFLICT (business_id) DO UPDATE
    SET
        -- If the current window has expired, reset; otherwise increment
        window_start  = CASE
            WHEN wa_business_usage.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE wa_business_usage.window_start
        END,
        message_count = CASE
            WHEN wa_business_usage.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1  -- new window
            ELSE wa_business_usage.message_count + 1
        END
    RETURNING window_start, message_count INTO v_window_start, v_count;

    -- Return whether this business is within the limit
    RETURN v_count <= p_max_msgs;
END;
$$;

COMMENT ON FUNCTION public.fn_wa_check_business_limit IS
  'Atomic aggregate rate limiter for businesses. Returns TRUE if allowed, FALSE if limited.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Garbage collection: purge stale business windows older than 24 hours
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_gc_business_usage()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM wa_business_usage
    WHERE window_start < now() - interval '24 hours';
$$;
