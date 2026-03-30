-- ============================================================================
-- Migration: WhatsApp bookings → auto-confirmed (Confirmación por Silencio)
--
-- Previously, WhatsApp AI bookings were created as 'pending' requiring
-- manual approval by the business owner. Now they are created as 'confirmed'
-- immediately — the owner can still cancel from the dashboard if needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_book_appointment_wa(
    p_business_id uuid,
    p_client_phone text,
    p_client_name text,
    p_service_id uuid,
    p_start_at timestamptz
)
RETURNS jsonb AS $$
DECLARE
    v_client_id uuid;
    v_duration int;
    v_end_at timestamptz;
    v_appointment_id uuid;
BEGIN
    -- 1. Get service duration
    SELECT duration_min INTO v_duration FROM public.services WHERE id = p_service_id;
    v_duration := COALESCE(v_duration, 30);
    v_end_at := p_start_at + (v_duration || ' minutes')::interval;

    -- 2. Upsert Client by Phone (using CLEAN phone for search)
    INSERT INTO public.clients (business_id, name, phone)
    VALUES (p_business_id, p_client_name, public.fn_clean_phone(p_client_phone))
    ON CONFLICT (business_id, phone) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
    RETURNING id INTO v_client_id;

    -- 3. Atomic check for availability
    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.status != 'cancelled'
          AND (a.start_at < v_end_at)
          AND (a.end_at > p_start_at)
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot no disponible.');
    END IF;

    -- 4. Create Appointment — auto-confirmed (Confirmación por Silencio)
    INSERT INTO public.appointments (
        business_id, client_id, service_id, start_at, end_at, status, notes
    ) VALUES (
        p_business_id, v_client_id, p_service_id, p_start_at, v_end_at, 'confirmed', 'Agendado vía WhatsApp AI'
    ) RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
