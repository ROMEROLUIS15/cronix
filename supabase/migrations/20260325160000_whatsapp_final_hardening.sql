-- 20260325160000_whatsapp_final_hardening.sql

-- 1. Ensure UNIQUE constraint for clients (required for ON CONFLICT in RPC)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_business_phone_unique_key') THEN
        ALTER TABLE public.clients ADD CONSTRAINT clients_business_phone_unique_key UNIQUE (business_id, phone);
    END IF;
END $$;

-- 2. wa_audit_logs Hardening
ALTER TABLE public.wa_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Only members of the business can see its audit logs
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'wa_audit_logs_isolation') THEN
        CREATE POLICY "wa_audit_logs_isolation" ON public.wa_audit_logs
        FOR ALL
        TO authenticated
        USING (
            business_id IN (
                SELECT u.business_id FROM public.users u WHERE u.id = auth.uid()
            )
        );
    END IF;
END $$;

-- 3. Robust Business Matching Function
-- Handles both the display phone and the Meta Phone Number ID.
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
  WHERE 
    -- Match by cleaned phone number (Display Phone)
    public.fn_clean_phone(b.phone) = public.fn_clean_phone(p_wa_phone_id)
    OR
    -- Match by Meta Phone ID stored in settings
    (b.settings->>'wa_phone_number_id') = p_wa_phone_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Fix fn_book_appointment_wa to target the specific constraint
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

    -- 4. Create Appointment
    INSERT INTO public.appointments (
        business_id, client_id, service_id, start_at, end_at, status, notes
    ) VALUES (
        p_business_id, v_client_id, p_service_id, p_start_at, v_end_at, 'pending', 'Agendado vía WhatsApp AI'
    ) RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object('success', true, 'appointment_id', v_appointment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
