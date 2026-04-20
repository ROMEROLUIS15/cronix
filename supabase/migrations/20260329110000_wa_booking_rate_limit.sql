-- 20260329110000_wa_booking_rate_limit.sql
-- Anti-spam: limits WhatsApp bookings per sender per business to prevent
-- calendar flooding with fake appointments.
--
-- Strategy: atomic counter per (sender_phone, business_id) with 24-hour window.
-- Only CONFIRM_BOOKING actions are counted — not messages or reschedules.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Booking rate limit counter table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wa_booking_limits (
    sender_phone  text        NOT NULL,
    business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    window_start  timestamptz NOT NULL DEFAULT now(),
    booking_count int         NOT NULL DEFAULT 1,
    PRIMARY KEY (sender_phone, business_id)
);
COMMENT ON TABLE public.wa_booking_limits IS
  'Anti-spam: tracks WhatsApp bookings per sender per business within a 24-hour window.';
CREATE INDEX IF NOT EXISTS idx_wa_booking_limits_business
  ON public.wa_booking_limits (business_id);
-- RLS: only service_role (Edge Functions) accesses this table
ALTER TABLE public.wa_booking_limits ENABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic booking-limit check function
--
-- Returns TRUE  → booking allowed (counter incremented)
--         FALSE → limit exceeded (counter NOT incremented)
--
-- Parameters:
--   p_sender      — WhatsApp phone number
--   p_business_id — target business UUID
--   p_window_secs — window in seconds (default 86400 = 24 hours)
--   p_max_bookings— max new bookings per window (default 2)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_check_booking_limit(
    p_sender       text,
    p_business_id  uuid,
    p_window_secs  int DEFAULT 86400,
    p_max_bookings int DEFAULT 2
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now   timestamptz := now();
    v_count int;
BEGIN
    INSERT INTO wa_booking_limits (sender_phone, business_id, window_start, booking_count)
    VALUES (p_sender, p_business_id, v_now, 1)
    ON CONFLICT (sender_phone, business_id) DO UPDATE
    SET
        window_start  = CASE
            WHEN wa_booking_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE wa_booking_limits.window_start
        END,
        booking_count = CASE
            WHEN wa_booking_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1
            ELSE wa_booking_limits.booking_count + 1
        END
    RETURNING booking_count INTO v_count;

    RETURN v_count <= p_max_bookings;
END;
$$;
COMMENT ON FUNCTION public.fn_wa_check_booking_limit IS
  'Atomic booking rate limiter per sender+business. Returns TRUE if booking allowed.';
