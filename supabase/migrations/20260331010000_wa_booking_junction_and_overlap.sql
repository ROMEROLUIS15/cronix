-- ============================================================================
-- Migration: AI booking consistency + overlap safety
--
-- 1. Updates fn_book_appointment_wa to also insert into appointment_services
--    junction table (Bug 2: AI bookings now have same data shape as dashboard).
--
-- 2. Back-fills existing AI appointments that are missing appointment_services
--    junction records.
--
-- The overlap check remains business-wide (correct for AI — no employee info).
-- ============================================================================

-- ── 1. Replace RPC with junction-table insert ────────────────────────────────

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

    -- 3. Atomic check for availability (business-wide overlap)
    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
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

    -- 5. Insert into appointment_services junction (data parity with dashboard)
    INSERT INTO public.appointment_services (appointment_id, service_id, sort_order)
    VALUES (v_appointment_id, p_service_id, 0);

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ── 2. Back-fill existing AI appointments missing junction records ───────────

INSERT INTO public.appointment_services (appointment_id, service_id, sort_order)
SELECT a.id, a.service_id, 0
FROM public.appointments a
WHERE a.notes = 'Agendado vía WhatsApp AI'
  AND a.service_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.appointment_services aps
    WHERE aps.appointment_id = a.id
  );
