-- 20260618120000_wa_booking_validate_service.sql
--
-- BUG (prod): WhatsApp bookings intermittently failed with DB_ERROR.
--
-- ROOT CAUSE: the llama-3.1-8b agent sometimes passed a service_id that did not
-- belong to the business (it copied the example UUID hardcoded in the system
-- prompt instead of the real catalog REF#). The id reached fn_book_appointment_wa
-- unchecked → the INSERT into appointments raised
-- "appointments_service_id_fkey" → the RPC errored → adapter returned DB_ERROR.
-- Confirmed via postgres logs (FK violation) + ai_traces (outcome=failure).
--
-- The primary fix lives in the WhatsApp adapter (it now validates service_id
-- against the loaded catalog before calling this RPC) and the prompt (example
-- UUID removed). This migration is DEFENSE IN DEPTH: the RPC itself now rejects a
-- service_id that doesn't belong to the business with a clean, mapped result
-- instead of letting the FK violation crash the function — for ANY caller.
--
-- Same signature → CREATE OR REPLACE replaces the function (no overload).

CREATE OR REPLACE FUNCTION public.fn_book_appointment_wa(
  p_business_id  uuid,
  p_client_phone text,
  p_client_name  text,
  p_service_id   uuid,
  p_start_at     timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_client_id      uuid;
    v_clean_phone    text;
    v_duration       int;
    v_end_at         timestamptz;
    v_appointment_id uuid;
    v_safe_name      text;
BEGIN
    v_clean_phone := public.fn_clean_phone(p_client_phone);

    -- Never null: real name if provided, otherwise an identifiable placeholder.
    v_safe_name := COALESCE(
        NULLIF(btrim(p_client_name), ''),
        'Cliente ' || right(v_clean_phone, 4)
    );

    -- Validate the service belongs to THIS business before doing anything else.
    -- Prevents a stray/hallucinated service_id from hitting the FK constraint.
    SELECT duration_min INTO v_duration
    FROM public.services
    WHERE id = p_service_id AND business_id = p_business_id;

    IF v_duration IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SERVICE_NOT_FOUND');
    END IF;

    v_end_at := p_start_at + (v_duration || ' minutes')::interval;

    -- Existing client by normalised phone (uses idx_clients_business_phone_digits).
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE business_id  = p_business_id
      AND phone_digits = v_clean_phone
      AND deleted_at  IS NULL
    LIMIT 1;

    IF v_client_id IS NULL THEN
        -- Try to create. The partial unique index will reject a concurrent
        -- duplicate; in that case re-query the existing row.
        BEGIN
            INSERT INTO public.clients (business_id, name, phone)
            VALUES (p_business_id, v_safe_name, v_clean_phone)
            RETURNING id INTO v_client_id;
        EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_client_id
            FROM public.clients
            WHERE business_id  = p_business_id
              AND phone_digits = v_clean_phone
              AND deleted_at  IS NULL
            LIMIT 1;
            -- Existing client: preserve curated name, only touch updated_at.
            IF v_client_id IS NOT NULL THEN
                UPDATE public.clients
                SET updated_at = now()
                WHERE id = v_client_id;
            END IF;
        END;
    ELSE
        -- Existing client: preserve curated name, only touch updated_at.
        UPDATE public.clients
        SET updated_at = now()
        WHERE id = v_client_id;
    END IF;

    -- Business-wide overlap check (correct for WhatsApp — no employee scope).
    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND (a.start_at < v_end_at)
          AND (a.end_at   > p_start_at)
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot no disponible.');
    END IF;

    INSERT INTO public.appointments (
        business_id, client_id, service_id, start_at, end_at, status, notes
    ) VALUES (
        p_business_id, v_client_id, p_service_id, p_start_at, v_end_at,
        'confirmed', 'Agendado vía WhatsApp AI'
    )
    RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object(
        'success',        true,
        'appointment_id', v_appointment_id
    );
END;
$function$;
