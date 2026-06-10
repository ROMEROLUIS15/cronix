-- 20260610120000_referral_bonus_atomic.sql
-- H1 saneamiento — descuadre irreversible del bono de referido.
--
-- Antes: applyReferralBonus() corría en Node DESPUÉS del COMMIT del RPC de pago.
-- Si Node moría entre el COMMIT y el UPDATE del bono, el reintento del webhook
-- veía la factura ya 'finished' (idempotencia) y SALTABA el bono → el referidor
-- perdía sus 30 días de forma permanente y sin reconciliación.
--
-- Ahora: el bono vive en una única función SQL (fuente de verdad), aplicada
-- DENTRO de la misma transacción que finaliza el pago de PayPal. La vía cripto
-- invoca la misma función vía rpc(). Reemplaza la lógica TS duplicada.
--
-- p_days debe coincidir con REFERRAL_BONUS_DAYS en lib/plans/plan-limits.ts (30).

-- ─────────────────────────────────────────────────────────────────────────────
-- Fuente única de verdad del bono de referido.
-- Idempotente: solo aplica en el PRIMER pago 'finished' del referido (count = 1).
-- Debe ejecutarse en la MISMA transacción donde la factura pasó a 'finished'
-- para que el conteo la incluya.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_apply_referral_bonus(
    p_referred_business_id uuid,
    p_days                 int DEFAULT 30
)
RETURNS TABLE (
    applied      boolean,
    referrer_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_referred_by  uuid;
    v_finished_cnt int;
    v_ref_plan     text;
    v_ref_end      timestamptz;
BEGIN
    SELECT referred_by_id INTO v_referred_by
    FROM public.businesses
    WHERE id = p_referred_business_id;

    IF v_referred_by IS NULL THEN
        RETURN QUERY SELECT false, NULL::uuid;
        RETURN;
    END IF;

    -- Solo en el primer pago finished — evita aplicar el bono en renovaciones.
    SELECT count(*) INTO v_finished_cnt
    FROM public.saas_invoices
    WHERE business_id = p_referred_business_id
      AND status = 'finished';

    IF v_finished_cnt <> 1 THEN
        RETURN QUERY SELECT false, NULL::uuid;
        RETURN;
    END IF;

    -- El referidor debe tener un plan de pago activo.
    SELECT plan, subscription_ends_at INTO v_ref_plan, v_ref_end
    FROM public.businesses
    WHERE id = v_referred_by
    FOR UPDATE;

    IF v_ref_plan IS NULL OR v_ref_plan = 'free' THEN
        RETURN QUERY SELECT false, NULL::uuid;
        RETURN;
    END IF;

    -- Aditivo: si aún no expiró, suma al tiempo restante; si expiró, parte de ahora.
    UPDATE public.businesses
    SET subscription_ends_at = GREATEST(COALESCE(v_ref_end, NOW()), NOW()) + (p_days || ' days')::interval,
        updated_at = NOW()
    WHERE id = v_referred_by;

    INSERT INTO public.notifications (business_id, title, content, type)
    VALUES (
        v_referred_by,
        '¡Mes gratis ganado! 🎁',
        'Un negocio que invitaste ha activado su plan Pro. Hemos añadido 30 días adicionales a tu suscripción.',
        'success'
    );

    RETURN QUERY SELECT true, v_referred_by;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_apply_referral_bonus(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_referral_bonus(uuid, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Finalización de PayPal — ahora aplica el bono DENTRO de la transacción.
-- Devuelve además si el bono se aplicó y a quién, para que Node dispare el push
-- best-effort (la notificación in-app sí queda persistida atómicamente arriba).
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_finalize_paypal_payment(text, numeric, integer);

CREATE OR REPLACE FUNCTION public.fn_finalize_paypal_payment(
    p_order_id          text,
    p_captured_amount   numeric,
    p_days              int DEFAULT 30
)
RETURNS TABLE (
    result_status           text,
    invoice_id              uuid,
    business_id             uuid,
    plan_purchased          text,
    referral_bonus_applied  boolean,
    referrer_business_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_invoice      public.saas_invoices%ROWTYPE;
    v_current_end  timestamptz;
    v_next_end     timestamptz;
    v_bonus        record;
BEGIN
    SELECT * INTO v_invoice
    FROM public.saas_invoices
    WHERE np_invoice_id = p_order_id
      AND payment_method = 'paypal'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'invoice_not_found'::text, NULL::uuid, NULL::uuid, NULL::text, false, NULL::uuid;
        RETURN;
    END IF;

    IF v_invoice.status = 'finished' THEN
        RETURN QUERY SELECT 'already_processed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text, false, NULL::uuid;
        RETURN;
    END IF;

    IF p_captured_amount IS NULL OR ABS(p_captured_amount - v_invoice.amount_usd) > 0.01 THEN
        RETURN QUERY SELECT 'amount_mismatch'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text, false, NULL::uuid;
        RETURN;
    END IF;

    UPDATE public.saas_invoices
    SET status = 'finished',
        updated_at = NOW()
    WHERE id = v_invoice.id;

    SELECT subscription_ends_at INTO v_current_end
    FROM public.businesses
    WHERE id = v_invoice.business_id;

    v_next_end := GREATEST(COALESCE(v_current_end, NOW()), NOW()) + (p_days || ' days')::interval;

    UPDATE public.businesses
    SET plan = v_invoice.plan_purchased,
        subscription_ends_at = v_next_end,
        updated_at = NOW()
    WHERE id = v_invoice.business_id;

    -- Bono de referido en la MISMA transacción — ya no hay ventana post-commit.
    SELECT * INTO v_bonus
    FROM public.fn_apply_referral_bonus(v_invoice.business_id, p_days);

    RETURN QUERY SELECT 'completed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased::text,
                        COALESCE(v_bonus.applied, false), v_bonus.referrer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_finalize_paypal_payment(text, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_paypal_payment(text, numeric, integer) TO service_role;
