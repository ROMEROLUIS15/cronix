-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Atomic reminder upsert
--
-- Replaces the application-level DELETE + INSERT (two HTTP round-trips) with
-- a single RPC that runs both statements inside one PostgreSQL transaction.
-- Eliminates the race window where a crash between DELETE and INSERT would
-- permanently lose the pending reminder.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_upsert_reminder(
  p_appointment_id UUID,
  p_business_id    UUID,
  p_remind_at      TIMESTAMPTZ,
  p_minutes_before INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Delete existing pending reminder atomically
  DELETE FROM public.appointment_reminders
  WHERE appointment_id = p_appointment_id
    AND status = 'pending';

  -- Insert new reminder (still within the same transaction)
  INSERT INTO public.appointment_reminders
    (appointment_id, business_id, remind_at, minutes_before, status, channel)
  VALUES
    (p_appointment_id, p_business_id, p_remind_at, p_minutes_before, 'pending', 'whatsapp')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_upsert_reminder(UUID, UUID, TIMESTAMPTZ, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_upsert_reminder(UUID, UUID, TIMESTAMPTZ, INT) TO service_role;
