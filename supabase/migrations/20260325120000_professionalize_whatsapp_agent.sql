-- 20260325120000_professionalize_whatsapp_agent.sql

-- 1. Utility: Clean phone number (leave only digits)
CREATE OR REPLACE FUNCTION public.fn_clean_phone(p_phone text)
RETURNS text AS $$
BEGIN
  RETURN regexp_replace(p_phone, '\D', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.wa_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id uuid REFERENCES public.businesses(id),
    sender_phone text,
    message_text text,
    ai_response text,
    tool_calls jsonb,
    created_at timestamptz DEFAULT now()
);

-- 3. Get Business by Phone (Secure Meta Mapping)
CREATE OR REPLACE FUNCTION public.fn_get_business_by_phone(p_wa_phone_id text)
RETURNS TABLE (
    id uuid,
    name text,
    timezone text,
    settings jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.name, b.timezone, b.settings
  FROM public.businesses b
  WHERE public.fn_clean_phone(b.phone) = public.fn_clean_phone(p_wa_phone_id)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Get Available Slots (Professional with interval check)
CREATE OR REPLACE FUNCTION public.fn_get_available_slots(
    p_business_id uuid, 
    p_date date,
    p_service_id uuid
)
RETURNS TABLE (slot_time text) AS $$
DECLARE
    v_open text;
    v_close text;
    v_duration int;
    v_current interval;
    v_end interval;
    v_slot_interval interval;
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
    v_duration := COALESCE(v_duration, 30); -- fallback to 30min
    v_slot_interval := (v_duration || ' minutes')::interval;

    IF v_open IS NULL OR v_close IS NULL THEN
        RETURN;
    END IF;

    v_current := v_open::interval;
    v_end := v_close::interval;

    WHILE v_current + v_slot_interval <= v_end LOOP
        -- Check if ANY appointment overlaps with this slot
        IF NOT EXISTS (
            SELECT 1 FROM public.appointments a
            WHERE a.business_id = p_business_id
              AND a.status != 'cancelled'
              -- Logic: (start1 < end2) AND (end1 > start2)
              AND (a.start_at < (p_date + v_current + v_slot_interval))
              AND (a.end_at > (p_date + v_current))
        ) THEN
            slot_time := to_char(v_current, 'HH24:MI');
            RETURN NEXT;
        END IF;
        
        -- Advance by 30 mins or by duration (let's stick to 30 mins for granularity)
        v_current := v_current + '30 minutes'::interval;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Book Appointment (Atomic check & create)
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

    -- 2. Upsert Client by Phone
    INSERT INTO public.clients (business_id, name, phone)
    VALUES (p_business_id, p_client_name, p_client_phone)
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

    -- 4. Create Appointment
    INSERT INTO public.appointments (
        business_id, client_id, service_id, start_at, end_at, status, notes
    ) VALUES (
        p_business_id, v_client_id, p_service_id, p_start_at, v_end_at, 'pending', 'Agendado vía WhatsApp AI'
    ) RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
