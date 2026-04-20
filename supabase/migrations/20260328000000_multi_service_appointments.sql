-- ============================================================================
-- Migration: Multi-Service Appointments
--
-- Allows an appointment to have one or more services via a junction table.
-- Backward compatible: existing service_id column remains (nullable) for
-- WhatsApp RPC and legacy reads. A trigger keeps both in sync.
-- ============================================================================

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS public.appointment_services (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id  uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  sort_order      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(appointment_id, service_id)
);
CREATE INDEX idx_appointment_services_appointment ON public.appointment_services(appointment_id);
CREATE INDEX idx_appointment_services_service     ON public.appointment_services(service_id);
-- 2. Enable RLS (policy mirrors appointments — scoped by business_id through parent)
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appointment_services_all" ON public.appointment_services
  FOR ALL
  USING (
    appointment_id IN (
      SELECT a.id FROM public.appointments a
      WHERE a.business_id IN (
        SELECT u.business_id FROM public.users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    appointment_id IN (
      SELECT a.id FROM public.appointments a
      WHERE a.business_id IN (
        SELECT u.business_id FROM public.users u WHERE u.id = auth.uid()
      )
    )
  );
-- 3. Backfill existing data from appointments.service_id
INSERT INTO public.appointment_services (appointment_id, service_id, sort_order)
SELECT id, service_id, 0
FROM public.appointments
WHERE service_id IS NOT NULL
ON CONFLICT (appointment_id, service_id) DO NOTHING;
-- 4. Make service_id nullable (WhatsApp RPC still writes to it)
ALTER TABLE public.appointments ALTER COLUMN service_id DROP NOT NULL;
-- 5. Sync trigger: when service_id is written (by WhatsApp RPC), mirror to junction table
CREATE OR REPLACE FUNCTION public.sync_service_to_junction()
RETURNS trigger AS $$
BEGIN
  IF NEW.service_id IS NOT NULL THEN
    INSERT INTO public.appointment_services (appointment_id, service_id, sort_order)
    VALUES (NEW.id, NEW.service_id, 0)
    ON CONFLICT (appointment_id, service_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER trg_sync_service_junction
  AFTER INSERT OR UPDATE OF service_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_to_junction();
-- 6. Grant service_role full access (Edge Functions bypass RLS)
GRANT ALL ON public.appointment_services TO service_role;
