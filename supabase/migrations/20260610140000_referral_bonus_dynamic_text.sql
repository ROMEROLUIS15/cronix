-- 20260610140000_referral_bonus_dynamic_text.sql
-- G2.3 saneamiento — SSOT del bono de referido (días).
--
-- Antes: el texto de la notificación in-app del bono hardcodeaba "30 días",
-- independiente del parámetro p_days que extiende la suscripción. Si la fuente
-- de verdad (REFERRAL_BONUS_DAYS en lib/plans/plan-limits.ts, inyectada por Node
-- como p_days en fn_finalize_paypal_payment / fn_finalize_crypto_payment) cambiaba
-- a otro valor, el referidor recibía X días pero la notificación seguía diciendo
-- "30 días" → incoherencia visible al usuario.
--
-- Ahora: el texto deriva de p_days. El SSOT es REFERRAL_BONUS_DAYS (TS); el RPC lo
-- recibe vía p_days y lo refleja tanto en la extensión como en el mensaje. El
-- DEFAULT 30 de la firma es solo un fallback de seguridad para llamadas SQL
-- directas; el runtime SIEMPRE inyecta el valor explícito desde la constante.
--
-- CREATE OR REPLACE idempotente; misma firma, mismos grants. Solo cambia el
-- cuerpo del texto de notificación.

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

    -- Texto derivado de p_days (no hardcodeado): refleja el valor real del SSOT.
    INSERT INTO public.notifications (business_id, title, content, type)
    VALUES (
        v_referred_by,
        '¡Mes gratis ganado! 🎁',
        'Un negocio que invitaste ha activado su plan Pro. Hemos añadido ' || p_days || ' días adicionales a tu suscripción.',
        'success'
    );

    RETURN QUERY SELECT true, v_referred_by;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_apply_referral_bonus(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_referral_bonus(uuid, int) TO service_role;
