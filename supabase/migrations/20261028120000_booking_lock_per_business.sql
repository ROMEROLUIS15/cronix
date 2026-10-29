-- 20261028120000_booking_lock_per_business.sql
--
-- Reservas simultáneas: fn_book_appointment_wa y fn_reschedule_appointment_wa leían si el
-- horario estaba libre y después escribían, sin bloqueo: dos reservas al mismo tiempo para
-- el mismo horario podían pasar las dos. Ahora toman un advisory lock por negocio antes del
-- chequeo de solape, así la segunda espera a que la primera termine y ve su cita.
--
-- No cambia qué cuenta como solape (el mismo chequeo a nivel negocio de siempre) ni toca
-- las citas existentes ni los solapes que el dueño confirma en el dashboard
-- (is_dual_booking). El solape por empleado queda para el sprint multi-empleado.
--
-- fn_book_appointment_wa responde el conflicto como 'SLOT_CONFLICT', el mismo código que
-- fn_reschedule_appointment_wa; antes era el texto 'Slot no disponible.', que el adapter
-- (booking-adapter.ts) no reconocía y reportaba como DB_ERROR.
--
-- Mismas firmas → CREATE OR REPLACE reemplaza sin crear overloads y conserva los grants.

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

    -- Una reserva a la vez por negocio: el chequeo de solape y el INSERT/UPDATE no
    -- pueden intercalarse con otra reserva del mismo negocio. Se libera al terminar
    -- la transacción.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('appointment_booking'), pg_catalog.hashtext(p_business_id::text)
    );

    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND (a.start_at < v_end_at)
          AND (a.end_at   > p_start_at)
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'SLOT_CONFLICT');
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

CREATE OR REPLACE FUNCTION public.fn_reschedule_appointment_wa(
    p_appointment_id uuid,
    p_business_id    uuid,
    p_new_start_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_original_start timestamptz;
    v_original_end   timestamptz;
    v_new_end_at     timestamptz;
BEGIN
    -- Una reserva a la vez por negocio: el chequeo de solape y el INSERT/UPDATE no
    -- pueden intercalarse con otra reserva del mismo negocio. Se libera al terminar
    -- la transacción.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('appointment_booking'), pg_catalog.hashtext(p_business_id::text)
    );

    -- Fetch + lock the original row
    SELECT start_at, end_at
    INTO v_original_start, v_original_end
    FROM public.appointments
    WHERE id = p_appointment_id
      AND business_id = p_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
    END IF;

    v_new_end_at := p_new_start_at + (v_original_end - v_original_start);

    -- Overlap check, excluding the appointment being moved
    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.id <> p_appointment_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND (a.start_at < v_new_end_at)
          AND (a.end_at > p_new_start_at)
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'SLOT_CONFLICT');
    END IF;

    UPDATE public.appointments
    SET start_at   = p_new_start_at,
        end_at     = v_new_end_at,
        updated_at = now()
    WHERE id = p_appointment_id
      AND business_id = p_business_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
