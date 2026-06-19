-- 20260619010000_wa_booking_upgrade_placeholder_name.sql
--
-- Invariante N1 (nombre real del cliente) — caso clientes EXISTENTES.
-- El fix anterior (20260618120000 + adapter) ya hace que un cliente NUEVO se cree con
-- el nombre real de perfil de WhatsApp. Pero un cliente creado ANTES de ese fix quedó
-- con el placeholder "Cliente <últimos4>", y la RPC preservaba el nombre existente
-- (solo bump updated_at) → el placeholder nunca se corregía y se propagaba a las
-- notificaciones y al recordatorio diario.
--
-- FIX: si el cliente existente tiene un nombre PLACEHOLDER (^Cliente( <dígitos>)?$) y
-- llega un nombre real (p_client_name no vacío; el adapter ya filtra el genérico
-- "Cliente"), se asciende el nombre al real. Un nombre ya curado por el dueño (no
-- placeholder) NUNCA se pisa. Misma firma → CREATE OR REPLACE reemplaza limpio.

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
    v_incoming_name  text;
BEGIN
    v_clean_phone   := public.fn_clean_phone(p_client_phone);
    -- Real name only (the adapter already passes NULL for the generic "Cliente").
    v_incoming_name := NULLIF(btrim(p_client_name), '');
    -- Never null for INSERT: real name, otherwise an identifiable placeholder.
    v_safe_name     := COALESCE(v_incoming_name, 'Cliente ' || right(v_clean_phone, 4));

    -- Validate the service belongs to THIS business before anything else.
    SELECT duration_min INTO v_duration
    FROM public.services
    WHERE id = p_service_id AND business_id = p_business_id;

    IF v_duration IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SERVICE_NOT_FOUND');
    END IF;

    v_end_at := p_start_at + (v_duration || ' minutes')::interval;

    SELECT id INTO v_client_id
    FROM public.clients
    WHERE business_id  = p_business_id
      AND phone_digits = v_clean_phone
      AND deleted_at  IS NULL
    LIMIT 1;

    IF v_client_id IS NULL THEN
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
            -- Upgrade a placeholder name to the real one; never overwrite a curated name.
            IF v_client_id IS NOT NULL THEN
                UPDATE public.clients
                SET name = CASE
                             WHEN v_incoming_name IS NOT NULL AND name ~ '^Cliente( [0-9]+)?$'
                             THEN v_incoming_name ELSE name
                           END,
                    updated_at = now()
                WHERE id = v_client_id;
            END IF;
        END;
    ELSE
        -- Existing client: upgrade placeholder → real name; preserve curated names.
        UPDATE public.clients
        SET name = CASE
                     WHEN v_incoming_name IS NOT NULL AND name ~ '^Cliente( [0-9]+)?$'
                     THEN v_incoming_name ELSE name
                   END,
            updated_at = now()
        WHERE id = v_client_id;
    END IF;

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

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$function$;
