-- 20260412000003_dashboard_stats_rpc.sql
-- FASE 2: Consolidate getDashboardStats into a single SQL function.
-- BEFORE: 4 queries (3 parallel + 1 sequential revenue)
-- AFTER:  1 query — 3 DB round-trips eliminated

CREATE OR REPLACE FUNCTION public.fn_get_dashboard_stats(
    p_business_id uuid,
    p_today_start text,      -- e.g. '2026-04-12'
    p_today_end text,        -- e.g. '2026-04-12'
    p_month_start text       -- e.g. '2026-04-01'
)
RETURNS TABLE (
    today_count     bigint,
    total_clients   bigint,
    pending_count   bigint,
    month_revenue   numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
    SELECT
        -- Today's appointments count
        (
            SELECT count(*)
            FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.start_at >= (p_today_start || 'T00:00:00')::timestamptz
              AND a.start_at <= (p_today_end || 'T23:59:59')::timestamptz
        ) AS today_count,

        -- Active clients count
        (
            SELECT count(*)
            FROM public.clients c
            WHERE c.business_id = p_business_id
              AND c.deleted_at IS NULL
        ) AS total_clients,

        -- Pending appointments
        (
            SELECT count(*)
            FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.status = 'pending'
        ) AS pending_count,

        -- Month revenue (sum of net_amount from paid transactions)
        COALESCE(
            (
                SELECT sum(t.net_amount)
                FROM public.transactions t
                WHERE t.business_id = p_business_id
                  AND t.paid_at >= (p_month_start || 'T00:00:00')::timestamptz
            ),
            0
        ) AS month_revenue;
$$;
