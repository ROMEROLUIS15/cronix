-- 20260610130000_crypto_finalize_rpc.sql
-- H1-bis — Finalización atómica de pagos cripto (NowPayments), análoga a PayPal.
--
-- Antes, `process-saas-payment` hacía UPDATEs REST sueltos (factura → business →
-- notificación → bono) sin transacción, con la misma ventana post-commit que
-- perdía el bono de referido. Esto incumplía la Constitución §5 (preferir RPC
-- para mutaciones críticas) y el manifest de pagos §2.
--
-- A diferencia de PayPal (que solo confirma una captura), el webhook cripto dispara
-- en cada transición de estado (waiting → confirming → finished / partially_paid),
-- por lo que el RPC SIEMPRE actualiza la factura y solo activa el plan + bono cuando
-- el estado entrante es 'finished'. No valida monto: NowPayments ya lo hace on-chain
-- y reporta 'finished' (pago completo) vs 'partially_paid'.

DROP FUNCTION IF EXISTS public.fn_finalize_crypto_payment(text, text, text, numeric, text, integer);

CREATE OR REPLACE FUNCTION public.fn_finalize_crypto_payment(
    p_np_invoice_id   text,
    p_np_payment_id   text,
    p_status          text,
    p_crypto_amount   numeric,
    p_crypto_currency text,
    p_days            int DEFAULT 30
)
RETURNS TABLE (
    result_status           text,    -- 'completed' | 'updated' | 'already_processed' | 'invoice_not_found'
    invoice_id              uuid,
    business_id             uuid,
    plan_purchased          text,
    invoice_status          text,    -- nuevo status persistido (Node decide notif de pago parcial)
    referral_bonus_applied  boolean,
    referrer_business_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_invoice     public.saas_invoices%ROWTYPE;
    v_current_end timestamptz;
    v_next_end    timestamptz;
    v_new_status  saas_invoice_status;
    v_bonus       record;
BEGIN
    v_new_status := p_status::saas_invoice_status;

    SELECT * INTO v_invoice
    FROM public.saas_invoices
    WHERE np_invoice_id = p_np_invoice_id
      AND payment_method = 'nowpayments'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'invoice_not_found'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, false, NULL::uuid;
        RETURN;
    END IF;

    -- Idempotencia: una factura ya finalizada no se reabre ni reactiva.
    IF v_invoice.status = 'finished' THEN
        RETURN QUERY SELECT 'already_processed'::text, v_invoice.id, v_invoice.business_id,
                            v_invoice.plan_purchased::text, v_invoice.status::text, false, NULL::uuid;
        RETURN;
    END IF;

    UPDATE public.saas_invoices
    SET status          = v_new_status,
        np_payment_id   = COALESCE(p_np_payment_id, np_payment_id),
        crypto_amount   = COALESCE(p_crypto_amount, crypto_amount),
        crypto_currency = COALESCE(p_crypto_currency, crypto_currency),
        updated_at      = NOW()
    WHERE id = v_invoice.id;

    -- Estado intermedio (waiting/confirming/partially_paid/…): solo se persiste la factura.
    IF v_new_status <> 'finished' THEN
        RETURN QUERY SELECT 'updated'::text, v_invoice.id, v_invoice.business_id,
                            v_invoice.plan_purchased::text, v_new_status::text, false, NULL::uuid;
        RETURN;
    END IF;

    -- status = finished → activar plan + aplicar bono en la MISMA transacción.
    SELECT subscription_ends_at INTO v_current_end
    FROM public.businesses
    WHERE id = v_invoice.business_id;

    v_next_end := GREATEST(COALESCE(v_current_end, NOW()), NOW()) + (p_days || ' days')::interval;

    UPDATE public.businesses
    SET plan = v_invoice.plan_purchased,
        subscription_ends_at = v_next_end,
        updated_at = NOW()
    WHERE id = v_invoice.business_id;

    SELECT * INTO v_bonus
    FROM public.fn_apply_referral_bonus(v_invoice.business_id, p_days);

    RETURN QUERY SELECT 'completed'::text, v_invoice.id, v_invoice.business_id,
                        v_invoice.plan_purchased::text, v_new_status::text,
                        COALESCE(v_bonus.applied, false), v_bonus.referrer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_finalize_crypto_payment(text, text, text, numeric, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_crypto_payment(text, text, text, numeric, text, integer) TO service_role;
