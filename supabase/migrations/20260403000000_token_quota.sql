-- 20260403000000_token_quota.sql
-- Precision cost control via Token Usage Quota.
--
-- Logic:
-- 1. Track daily token consumption per business in a dedicated table.
-- 2. Provide a check function to stop AI calls if quota is exceeded.
-- 3. Provide a track function to update usage after each LLM/Whisper call.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Token usage tracking table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wa_token_usage (
    business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    usage_date      date        NOT NULL DEFAULT current_date,
    total_tokens    bigint      NOT NULL DEFAULT 0,
    PRIMARY KEY (business_id, usage_date)
);
COMMENT ON TABLE public.wa_token_usage IS
  'Tracks daily cumulative token consumption for AI cost control.';
ALTER TABLE public.wa_token_usage ENABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic check for token quota
--
-- Returns TRUE if the business can still use tokens (has not reached the limit).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_check_token_quota(
    p_business_id  uuid,
    p_daily_limit  int DEFAULT 50000 -- Default to 50k tokens if not specified
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total bigint;
BEGIN
    SELECT total_tokens INTO v_total
    FROM wa_token_usage
    WHERE business_id = p_business_id AND usage_date = current_date;

    -- If no record yet, they've used 0 tokens today.
    IF NOT FOUND THEN
        RETURN TRUE;
    END IF;

    -- Check if within limit
    RETURN v_total < p_daily_limit;
END;
$$;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Update token usage
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_track_token_usage(
    p_business_id  uuid,
    p_tokens       int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO wa_token_usage (business_id, usage_date, total_tokens)
    VALUES (p_business_id, current_date, p_tokens)
    ON CONFLICT (business_id, usage_date)
    DO UPDATE SET total_tokens = wa_token_usage.total_tokens + EXCLUDED.total_tokens;
END;
$$;
