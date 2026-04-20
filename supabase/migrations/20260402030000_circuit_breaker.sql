-- 20260402030000_circuit_breaker.sql
-- Circuit Breaker implementation for external service protection.
--
-- Logic:
-- 1. Track service failures in a single row per service.
-- 2. If failure count >= threshold, OPEN the circuit for N minutes.
-- 3. During OPEN status, any check will fail (returning FALSE).
-- 4. After the timeout, the check will automatically CLOSE the circuit and try again.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Service health table
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.service_health (
    service_name    text        PRIMARY KEY, -- e.g., 'GROQ_LLM', 'GROQ_WHISPER'
    failure_count   int         NOT NULL DEFAULT 0,
    last_failure    timestamptz,
    status          text        NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('CLOSED', 'OPEN'))
);
COMMENT ON TABLE public.service_health IS
  'Tracks performance and health of external providers for Circuit Breaker pattern.';
ALTER TABLE public.service_health ENABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Atomic circuit check
--
-- Returns TRUE if the service is allowed to be called.
-- Returns FALSE if the circuit is OPEN (failure).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_check_circuit_breaker(
    p_service_name text,
    p_reset_mins   int DEFAULT 2
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status       text;
    v_last_failure timestamptz;
BEGIN
    SELECT status, last_failure INTO v_status, v_last_failure
    FROM service_health
    WHERE service_name = p_service_name;

    -- If no record exists, create one and allow
    IF NOT FOUND THEN
        INSERT INTO service_health (service_name) VALUES (p_service_name);
        RETURN TRUE;
    END IF;

    -- If circuit is OPEN, check if reset timeout has passed
    IF v_status = 'OPEN' THEN
        IF v_last_failure + (p_reset_mins || ' minutes')::interval < now() THEN
            -- Reset after timeout (HALF-OPEN logic simplified)
            UPDATE service_health 
            SET status = 'CLOSED', failure_count = 0
            WHERE service_name = p_service_name;
            RETURN TRUE;
        ELSE
            -- Still open
            RETURN FALSE;
        END IF;
    END IF;

    -- Standard CLOSED state
    RETURN TRUE;
END;
$$;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Failure reporting
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_report_service_failure(
    p_service_name text,
    p_threshold    int DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE service_health
    SET 
        failure_count = failure_count + 1,
        last_failure  = now(),
        status        = CASE WHEN failure_count + 1 >= p_threshold THEN 'OPEN' ELSE 'CLOSED' END
    WHERE service_name = p_service_name;
END;
$$;
-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Success reporting
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_wa_report_service_success(
    p_service_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE service_health
    SET failure_count = 0, status = 'CLOSED'
    WHERE service_name = p_service_name;
END;
$$;
