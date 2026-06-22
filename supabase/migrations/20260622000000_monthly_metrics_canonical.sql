-- 20260622000000_monthly_metrics_canonical.sql
-- Single canonical monthly aggregation consumed by Home, Finances and Reports.
--
-- WHY: the three dashboard sections each computed "monthly revenue" with a
-- different formula, time axis and bound — so their numbers never reconciled:
--   * Home / Finances: SUM(net_amount) by paid_at, NO upper bound ("this month
--     onward, forever").
--   * Reports: SUM(net_amount) by paid_at WITH upper bound, but per-service
--     revenue used the service LIST PRICE of completed appointments — a totally
--     different basis that can't sum to the transaction total.
--   * Finances expense filter compared a DATE column against an ISO timestamp
--     string, silently dropping expenses dated on the 1st of the month.
--
-- This function is the ONE source of truth. Two distinct, clearly-separated
-- metrics (decided with the owner), both attributed to a month by the
-- APPOINTMENT date (start_at):
--   * billed_revenue    — value of services rendered: SUM(service list price)
--                          of completed appointments started in the month.
--   * collected_revenue — real cash in: SUM(net_amount) of transactions whose
--                          linked appointment started in the month. Transactions
--                          with no linked appointment (manual / walk-in) fall
--                          back to their own paid_at, since they have no start_at.
--   * total_expenses    — SUM(amount) of expenses with expense_date in the month
--                          (compared as DATE, inclusive of the last day).

CREATE OR REPLACE FUNCTION public.fn_get_monthly_metrics(
    p_business_id uuid,
    p_month_start date          -- any date within the target month; the function
                                -- derives the full calendar month from it.
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
    RETURN QUERY
    SELECT
        -- Billed: list price of completed appointments, by appointment date.
        COALESCE((
            SELECT SUM(s.price)
            FROM public.appointments a
            JOIN public.services s ON s.id = a.service_id
            WHERE a.business_id = p_business_id
              AND a.status = 'completed'
              AND a.start_at >= v_start
              AND a.start_at <  v_end
        ), 0)::numeric AS billed_revenue,

        -- Collected: net_amount of transactions, attributed by the linked
        -- appointment's date; manual/walk-in transactions (no appointment)
        -- fall back to paid_at.
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

        -- Expenses: expense_date is a DATE column — compare as date so the 1st
        -- and last day of the month are both included.
        COALESCE((
            SELECT SUM(e.amount)
            FROM public.expenses e
            WHERE e.business_id = p_business_id
              AND e.expense_date >= v_start_date
              AND e.expense_date <  v_end_date
        ), 0)::numeric AS total_expenses;
END;
$$;

-- Redefine the dashboard-home revenue to share the SAME canonical definition
-- (collected). Everything else in the stats function is unchanged. This keeps a
-- single formula for "revenue" across the whole product.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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

        -- Month revenue = canonical "collected" (real cash, by appointment date).
        COALESCE(
            (SELECT m.collected_revenue
             FROM public.fn_get_monthly_metrics(p_business_id, p_month_start::date) m),
            0
        ) AS month_revenue;
$$;
