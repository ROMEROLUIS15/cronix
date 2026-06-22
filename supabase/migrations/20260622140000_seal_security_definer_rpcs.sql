-- 20260622140000_seal_security_definer_rpcs.sql
-- Systemic remediation of the SECURITY DEFINER + missing-tenant-guard pattern
-- audited alongside the dashboard fix (20260622120000).
--
-- Every SECURITY DEFINER function bypasses RLS, so any one that takes a
-- business_id and is reachable by `authenticated`/`anon` must EITHER assert the
-- caller owns that business (browser-facing) OR not be browser-reachable at all
-- (edge/agent-only → execute restricted to service_role).
--
-- Classification was driven by call-site analysis:
--   * GUARD (browser-facing, keep `authenticated`): ai_traces_summary_24h
--     (observability dashboard), get_clients_debts (owner reads own clients'
--     debts), fn_upsert_reminder (dashboard + edge booking).
--   * LOCK DOWN to service_role (only ever called by Deno edge functions with
--     the service_role key): fn_book_appointment_wa, fn_reschedule_appointment_wa,
--     fn_find_client_by_phone, fn_get_available_slots (both overloads),
--     fn_wa_check_booking_limit, fn_wa_check_business_limit,
--     fn_wa_check_token_quota, fn_wa_track_token_usage, match_ai_memories_v2.
--   * Already self-guards (no change): fn_mark_all_notifications_as_read checks
--     auth.uid() + business_id membership in its own body.
--
-- The guard helper fn_assert_business_access() was created in 20260622120000.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — Guard browser-facing functions
-- ─────────────────────────────────────────────────────────────────────────────

-- ai_traces_summary_24h: 24h observability rollup. Converted sql → plpgsql to
-- host the guard. Logic unchanged.
CREATE OR REPLACE FUNCTION public.ai_traces_summary_24h(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.fn_assert_business_access(p_business_id);

    RETURN (
        SELECT jsonb_build_object(
            'total',     count(*),
            'success',   count(*) FILTER (WHERE outcome = 'success'),
            'failures',  count(*) FILTER (WHERE outcome IN ('failure', 'error', 'rate_limited')),
            'no_action', count(*) FILTER (WHERE outcome = 'no_action'),
            'tokens',    COALESCE(sum(total_tokens), 0),
            'p50_ms',    COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms), 0),
            'p95_ms',    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)
        )
        FROM public.ai_traces
        WHERE business_id = p_business_id
          AND created_at > now() - interval '24 hours'
    );
END;
$$;

-- get_clients_debts: per-client outstanding debt for a business. Logic unchanged.
CREATE OR REPLACE FUNCTION public.get_clients_debts(p_business_id uuid)
RETURNS TABLE(client_id uuid, total_debt numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
    PERFORM public.fn_assert_business_access(p_business_id);

    RETURN QUERY
    WITH apt_costs AS (
        SELECT a.client_id, COALESCE(SUM(s.price), 0) AS expected_revenue
        FROM appointments a
        JOIN appointment_services aps ON aps.appointment_id = a.id
        JOIN services s ON s.id = aps.service_id
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.start_at < now()
        GROUP BY a.client_id
    ),
    apt_payments AS (
        SELECT a.client_id, COALESCE(SUM(t.net_amount), 0) AS actually_paid
        FROM appointments a
        JOIN transactions t ON t.appointment_id = a.id
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.start_at < now()
        GROUP BY a.client_id
    )
    SELECT c.client_id, (c.expected_revenue - COALESCE(p.actually_paid, 0)) AS total_debt
    FROM apt_costs c
    LEFT JOIN apt_payments p ON p.client_id = c.client_id
    WHERE (c.expected_revenue - COALESCE(p.actually_paid, 0)) > 0;
END;
$$;

-- get_clients_debts was PUBLIC by default — drop anon, keep the guarded read for
-- authenticated owners + service_role.
REVOKE ALL ON FUNCTION public.get_clients_debts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clients_debts(uuid) TO authenticated, service_role;

-- fn_upsert_reminder: schedules a WhatsApp reminder for an appointment. Called by
-- both the dashboard (authenticated owner) and the edge booking flow
-- (service_role). Logic unchanged.
CREATE OR REPLACE FUNCTION public.fn_upsert_reminder(
    p_appointment_id uuid,
    p_business_id uuid,
    p_remind_at timestamp with time zone,
    p_minutes_before integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public.fn_assert_business_access(p_business_id);

    DELETE FROM public.appointment_reminders
    WHERE appointment_id = p_appointment_id
      AND status = 'pending';

    INSERT INTO public.appointment_reminders
        (appointment_id, business_id, remind_at, minutes_before, status, channel)
    VALUES
        (p_appointment_id, p_business_id, p_remind_at, p_minutes_before, 'pending', 'whatsapp')
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — Lock down edge/agent-only functions to service_role
-- These are only ever invoked by Deno edge functions (WhatsApp / voice) using
-- the service_role key. They must not be reachable by browser sessions.
--
-- Resolved by OID (regprocedure) over every overload of each name, so the exact
-- argument types — including the `vector` type whose schema varies — never need
-- to be spelled out, and a name absent on a given database is simply skipped.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_edge_only text[] := ARRAY[
        'fn_book_appointment_wa',
        'fn_reschedule_appointment_wa',
        'fn_find_client_by_phone',
        'fn_get_available_slots',
        'fn_wa_check_booking_limit',
        'fn_wa_check_business_limit',
        'fn_wa_check_token_quota',
        'fn_wa_track_token_usage',
        'match_ai_memories_v2'
    ];
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (v_edge_only)
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
END $$;
