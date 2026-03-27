-- 20260325180000_fix_slots_timezone.sql
-- Fix: fn_get_available_slots now receives business timezone and converts
-- slot local times to UTC timestamptz before comparing with stored appointments.

CREATE OR REPLACE FUNCTION public.fn_get_available_slots(
    p_business_id uuid,
    p_date date,
    p_service_id uuid,
    p_timezone text DEFAULT 'UTC'
)
RETURNS TABLE (slot_time text) AS $$
DECLARE
    v_open          text;
    v_close         text;
    v_duration      int;
    v_current       interval;
    v_end           interval;
    v_slot_interval interval;
    v_slot_start    timestamptz;
    v_slot_end      timestamptz;
BEGIN
    -- Get business hours for that day
    SELECT
        (settings->'workingHours'->>(lower(to_char(p_date, 'dy'))))::json->>0,
        (settings->'workingHours'->>(lower(to_char(p_date, 'dy'))))::json->>1
    INTO v_open, v_close
    FROM public.businesses
    WHERE id = p_business_id;

    -- Get service duration
    SELECT duration_min INTO v_duration FROM public.services WHERE id = p_service_id;
    v_duration      := COALESCE(v_duration, 30);
    v_slot_interval := (v_duration || ' minutes')::interval;

    IF v_open IS NULL OR v_close IS NULL THEN
        RETURN; -- Business closed that day
    END IF;

    v_current := v_open::interval;
    v_end     := v_close::interval;

    WHILE v_current + v_slot_interval <= v_end LOOP
        -- Convert local slot time → UTC timestamptz for correct comparison
        -- e.g. '10:00' in 'America/Caracas' → 14:00 UTC
        v_slot_start := (p_date + v_current) AT TIME ZONE p_timezone;
        v_slot_end   := v_slot_start + v_slot_interval;

        -- Check if ANY stored appointment (UTC) overlaps this slot
        IF NOT EXISTS (
            SELECT 1 FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.status != 'cancelled'
              AND (a.start_at < v_slot_end)
              AND (a.end_at   > v_slot_start)
        ) THEN
            slot_time := to_char(v_current, 'HH24:MI');
            RETURN NEXT;
        END IF;

        v_current := v_current + '30 minutes'::interval;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
