-- 20260516130000_paypal_finalize_rpc.sql
-- Finalización atómica de pagos PayPal: factura + business en una transacción.
-- Llamada tanto desde la server action (frontend onApprove) como desde el webhook.

DROP FUNCTION IF EXISTS public.fn_finalize_paypal_payment(text, numeric, integer);

CREATE OR REPLACE FUNCTION public.fn_finalize_paypal_payment(
    p_order_id          text,
    p_captured_amount   numeric,
    p_days              int DEFAULT 30
)
RETURNS TABLE (
    result_status   text,         -- 'completed' | 'already_processed' | 'invoice_not_found' | 'amount_mismatch'
    invoice_id      uuid,
    business_id     uuid,
    plan_purchased  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_invoice         public.saas_invoices%ROWTYPE;
    v_current_end     timestamptz;
    v_next_end        timestamptz;
BEGIN
    -- Bloqueamos la fila para evitar carreras entre la action y el webhook
    SELECT * INTO v_invoice
    FROM public.saas_invoices
    WHERE np_invoice_id = p_order_id
      AND payment_method = 'paypal'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'invoice_not_found'::text, NULL::uuid, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_invoice.status = 'finished' THEN
        RETURN QUERY SELECT 'already_processed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text;
        RETURN;
    END IF;

    -- Tolerancia de 1 centavo por redondeos
    IF p_captured_amount IS NULL OR ABS(p_captured_amount - v_invoice.amount_usd) > 0.01 THEN
        RETURN QUERY SELECT 'amount_mismatch'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text;
        RETURN;
    END IF;

    UPDATE public.saas_invoices
    SET status = 'finished',
        updated_at = NOW()
    WHERE id = v_invoice.id;

    -- Lógica aditiva: si aún no expiró, sumamos al tiempo restante; si expiró, partimos de ahora
    SELECT subscription_ends_at INTO v_current_end
    FROM public.businesses
    WHERE id = v_invoice.business_id;

    v_next_end := GREATEST(COALESCE(v_current_end, NOW()), NOW()) + (p_days || ' days')::interval;

    UPDATE public.businesses
    SET plan = v_invoice.plan_purchased,
        subscription_ends_at = v_next_end,
        updated_at = NOW()
    WHERE id = v_invoice.business_id;

    RETURN QUERY SELECT 'completed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text;
END;
$$;

-- Solo service_role debe ejecutar — los clientes anónimos/auth no pueden activar planes
REVOKE EXECUTE ON FUNCTION public.fn_finalize_paypal_payment(text, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_paypal_payment(text, numeric, integer) TO service_role;
