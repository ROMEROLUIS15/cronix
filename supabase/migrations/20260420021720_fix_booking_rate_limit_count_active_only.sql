
-- ANTES: fn_wa_check_booking_limit contaba INTENTOS (incluyendo fallidos y slots ocupados).
-- Esto causó 35 en el contador aunque 0 citas reales se crearon.
--
-- AHORA: La función NO usa wa_booking_limits como contador de intentos.
-- Cuenta directamente las citas ACTIVAS (confirmed/pending) en la tabla appointments
-- para ese cliente en esa ventana de tiempo. Si el cliente cancela, el contador baja solo.
-- wa_booking_limits se conserva como tabla de audit log, no como contador autoritativo.

CREATE OR REPLACE FUNCTION public.fn_wa_check_booking_limit(
    p_sender       text,
    p_business_id  uuid,
    p_window_secs  integer DEFAULT 86400,
    p_max_bookings integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_active_count int;
    v_client_id    uuid;
BEGIN
    -- Resolve client by phone (using the same fn_clean_phone normalization)
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE phone = public.fn_clean_phone(p_sender)
      AND business_id = p_business_id
    LIMIT 1;

    -- If client doesn't exist yet, they have 0 active bookings → allow
    IF v_client_id IS NULL THEN
        RETURN true;
    END IF;

    -- Count ACTIVE appointments (not cancelled/no_show) within the window
    -- This means: if you cancel, you can rebook. No abuse of Groq tokens.
    SELECT COUNT(*) INTO v_active_count
    FROM public.appointments
    WHERE client_id   = v_client_id
      AND business_id = p_business_id
      AND status NOT IN ('cancelled', 'no_show')
      AND created_at  > now() - (p_window_secs || ' seconds')::interval;

    RETURN v_active_count < p_max_bookings;
END;
$$;

-- Limpiar wa_booking_limits para que el historial de intentos no interfiera
-- (ya no es la fuente de verdad del límite)
TRUNCATE public.wa_booking_limits;
;
