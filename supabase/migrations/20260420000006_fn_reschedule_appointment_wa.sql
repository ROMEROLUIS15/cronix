-- 20260420000006_fn_reschedule_appointment_wa.sql
-- Atomic reschedule RPC with slot-conflict guard (parity with fn_book_appointment_wa).
-- Prevents the WhatsApp agent from silently moving an appointment on top of another
-- active booking. Preserves the original appointment duration.
--
-- Returns jsonb:
--   { success: true }                                                       → update applied
--   { success: false, error: 'NOT_FOUND' }                                   → appointment missing or wrong business
--   { success: false, error: 'SLOT_CONFLICT' }                               → overlap with another active appointment

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

COMMENT ON FUNCTION public.fn_reschedule_appointment_wa IS
  'Atomic reschedule for the WhatsApp agent. Checks overlap against other active appointments before moving the target row. Returns structured jsonb result.';
