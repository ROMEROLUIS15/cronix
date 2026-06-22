-- 20260622120000_dashboard_rpc_tenant_guard.sql
-- Close a cross-tenant leak in the dashboard SECURITY DEFINER read functions.
--
-- PROBLEM: fn_get_dashboard_stats and fn_get_monthly_metrics are SECURITY DEFINER
-- (they bypass RLS) and are EXECUTE-able by `authenticated`/`anon` (PUBLIC), yet
-- they only filter by the `p_business_id` the CALLER passes — never verifying the
-- caller belongs to that business. Proven exploit: an authenticated session with
-- an unrelated uid could call fn_get_monthly_metrics('<other business>') and read
-- that tenant's revenue. Violates constitution §4 (business_id isolation).
--
-- FIX: a reusable authorization guard. A SECURITY DEFINER read scoped to a
-- business must assert the caller is allowed to read that business BEFORE
-- returning anything.

-- ── Reusable tenant-access guard ────────────────────────────────────────────
-- Raises 42501 (insufficient_privilege) unless the caller is:
--   * the service_role (trusted internal: edge functions / cron), OR
--   * a member of the target business (current_business_id()), OR
--   * a platform_admin.
CREATE OR REPLACE FUNCTION public.fn_assert_business_access(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN;
    END IF;

    IF p_business_id = public.current_business_id() THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'platform_admin'
    ) THEN
        RETURN;
    END IF;

    RAISE EXCEPTION 'forbidden: caller is not authorized for business %', p_business_id
        USING ERRCODE = '42501';
END;
$$;

-- ── fn_get_monthly_metrics — now guarded ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_monthly_metrics(
    p_business_id uuid,
    p_month_start date
)
RETURNS TABLE (
    billed_revenue    numeric,
    collected_revenue numeric,
    total_expenses    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_start      timestamptz := date_trunc('month', p_month_start::timestamptz);
    v_end        timestamptz := date_trunc('month', p_month_start::timestamptz) + interval '1 month';
    v_start_date date        := date_trunc('month', p_month_start)::date;
    v_end_date   date        := (date_trunc('month', p_month_start) + interval '1 month')::date;
BEGIN
    PERFORM public.fn_assert_business_access(p_business_id);

    RETURN QUERY
    SELECT
        COALESCE((
            SELECT SUM(s.price)
            FROM public.appointments a
            JOIN public.services s ON s.id = a.service_id
            WHERE a.business_id = p_business_id
              AND a.status = 'completed'
              AND a.start_at >= v_start
              AND a.start_at <  v_end
        ), 0)::numeric AS billed_revenue,
        COALESCE((
            SELECT SUM(t.net_amount)
            FROM public.transactions t
            LEFT JOIN public.appointments a
              ON a.id = t.appointment_id
             AND a.business_id = p_business_id
            WHERE t.business_id = p_business_id
              AND (
                    (a.id IS NOT NULL AND a.start_at >= v_start    AND a.start_at <  v_end)
                 OR (a.id IS NULL     AND t.paid_at  >= v_start    AND t.paid_at  <  v_end)
              )
        ), 0)::numeric AS collected_revenue,
        COALESCE((
            SELECT SUM(e.amount)
            FROM public.expenses e
            WHERE e.business_id = p_business_id
              AND e.expense_date >= v_start_date
              AND e.expense_date <  v_end_date
        ), 0)::numeric AS total_expenses;
END;
$$;

-- ── fn_get_dashboard_stats — converted to plpgsql + guarded ─────────────────
CREATE OR REPLACE FUNCTION public.fn_get_dashboard_stats(
    p_business_id uuid,
    p_today_start text,
    p_today_end text,
    p_month_start text
)
RETURNS TABLE (
    today_count     bigint,
    total_clients   bigint,
    pending_count   bigint,
    month_revenue   numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    PERFORM public.fn_assert_business_access(p_business_id);

    RETURN QUERY
    SELECT
        (
            SELECT count(*)
            FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.start_at >= (p_today_start || 'T00:00:00')::timestamptz
              AND a.start_at <= (p_today_end || 'T23:59:59')::timestamptz
        ) AS today_count,
        (
            SELECT count(*)
            FROM public.clients c
            WHERE c.business_id = p_business_id
              AND c.deleted_at IS NULL
        ) AS total_clients,
        (
            SELECT count(*)
            FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.status = 'pending'
        ) AS pending_count,
        COALESCE(
            (SELECT m.collected_revenue
             FROM public.fn_get_monthly_metrics(p_business_id, p_month_start::date) m),
            0
        ) AS month_revenue;
END;
$$;
