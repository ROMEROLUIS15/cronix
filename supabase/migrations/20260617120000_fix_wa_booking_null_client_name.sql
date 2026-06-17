-- 20260617120000_fix_wa_booking_null_client_name.sql
--
-- BUG (prod): EVERY WhatsApp booking failed with DB_ERROR.
--
-- ROOT CAUSE: WhatsAppBookingAdapter.confirmBooking calls fn_book_appointment_wa
-- with p_client_name = NULL (it identifies the client by phone, not name). The RPC
-- then wrote that NULL into clients.name on BOTH paths:
--   • new client:      INSERT INTO clients(..., name, ...) VALUES(..., NULL, ...)
--   • existing client: UPDATE clients SET name = NULL
-- clients.name is NOT NULL → every call raised a not-null violation → the RPC
-- errored → adapter returned DB_ERROR → the user saw "No pude procesar tu
-- solicitud". Confirmed via ai_traces (outcome=failure, error_code=DB_ERROR).
--
-- FIX:
--   • New client: default the name to "Cliente <last-4-digits>" when p_client_name
--     is null/blank, so the NOT NULL column is always satisfied.
--   • Existing client: NEVER overwrite the (possibly owner-curated) name — only
--     bump updated_at. This also makes the RPC null-safe regardless of caller.
--
-- Same signature as before → CREATE OR REPLACE cleanly replaces the function
-- (no overload created, unlike 20260504100000 — see 20260617000000).

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

    -- Resolve service duration (default to 30 if unknown).
    SELECT duration_min INTO v_duration
    FROM public.services WHERE id = p_service_id;
    v_duration := COALESCE(v_duration, 30);
    v_end_at   := p_start_at + (v_duration || ' minutes')::interval;

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
