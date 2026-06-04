-- 20260604000000_fix_dead_function_overload.sql
--
-- Fixes two categories of db-lint issues found by `supabase db lint`:
--
-- 1. ERROR — fn_wa_report_service_failure(text, text, int) was introduced by
--    20260412000000_performance_phase1.sql with wrong column names
--    (last_failure_at, circuit_state, error_message) that don't exist on
--    service_health (which has last_failure, status). The 3-param overload was
--    never called from application code (guards.ts calls the 2-param version);
--    the correct UPSERT was already applied in 20260412000005. Drop the dead one.
--
-- 2. WARNING-EXTRA — fn_wa_check_rate_limit, fn_wa_check_business_limit,
--    fn_web_check_rate_limit all DECLARE v_window_start and capture it via
--    RETURNING but never read it afterwards. Remove the dead variable.

-- ── 1. Drop broken overload ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_wa_report_service_failure(text, text, int);

-- ── 2. Fix dead v_window_start in fn_wa_check_rate_limit ─────────────────────

CREATE OR REPLACE FUNCTION public.fn_wa_check_rate_limit(
    p_sender       text,
    p_window_secs  int DEFAULT 60,
    p_max_msgs     int DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_now   timestamptz := now();
    v_count int;
BEGIN
    INSERT INTO wa_rate_limits (sender_phone, window_start, message_count)
    VALUES (p_sender, v_now, 1)
    ON CONFLICT (sender_phone) DO UPDATE
    SET
        window_start  = CASE
            WHEN wa_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE wa_rate_limits.window_start
        END,
        message_count = CASE
            WHEN wa_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1
            ELSE wa_rate_limits.message_count + 1
        END
    RETURNING message_count INTO v_count;

    RETURN v_count <= p_max_msgs;
END;
$$;

-- ── 3. Fix dead v_window_start in fn_wa_check_business_limit ─────────────────

CREATE OR REPLACE FUNCTION public.fn_wa_check_business_limit(
    p_business_id  uuid,
    p_window_secs  int DEFAULT 86400,
    p_max_msgs     int DEFAULT 500
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_now   timestamptz := now();
    v_count int;
BEGIN
    INSERT INTO wa_business_usage (business_id, window_start, message_count)
    VALUES (p_business_id, v_now, 1)
    ON CONFLICT (business_id) DO UPDATE
    SET
        window_start  = CASE
            WHEN wa_business_usage.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE wa_business_usage.window_start
        END,
        message_count = CASE
            WHEN wa_business_usage.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1
            ELSE wa_business_usage.message_count + 1
        END
    RETURNING message_count INTO v_count;

    RETURN v_count <= p_max_msgs;
END;
$$;

-- ── 4. Fix dead v_window_start in fn_web_check_rate_limit ────────────────────

CREATE OR REPLACE FUNCTION public.fn_web_check_rate_limit(
    p_identifier  text,
    p_window_secs int DEFAULT 60,
    p_max_req     int DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_now   timestamptz := now();
    v_count int;
BEGIN
    INSERT INTO web_rate_limits (identifier, window_start, request_count)
    VALUES (p_identifier, v_now, 1)
    ON CONFLICT (identifier) DO UPDATE
    SET
        window_start  = CASE
            WHEN web_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN v_now
            ELSE web_rate_limits.window_start
        END,
        request_count = CASE
            WHEN web_rate_limits.window_start + (p_window_secs || ' seconds')::interval < v_now
            THEN 1
            ELSE web_rate_limits.request_count + 1
        END
    RETURNING request_count INTO v_count;

    RETURN v_count <= p_max_req;
END;
$$;
