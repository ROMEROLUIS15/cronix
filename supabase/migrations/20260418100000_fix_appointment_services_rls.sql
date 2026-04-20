-- 20260418100000_fix_appointment_services_rls.sql
-- Fix: 20260414000000_rls_current_business_id.sql dropped WITH CHECK from
-- appointment_services, making INSERT/UPDATE/DELETE silently fail for
-- authenticated users. This blocked manual edit, delete, and confirm from the UI.

DROP POLICY IF EXISTS "appointment_services_all" ON public.appointment_services;
CREATE POLICY "appointment_services_all" ON public.appointment_services
  FOR ALL TO authenticated
  USING (
    appointment_id IN (
      SELECT a.id FROM public.appointments a
      WHERE a.business_id = public.current_business_id()
    )
  )
  WITH CHECK (
    appointment_id IN (
      SELECT a.id FROM public.appointments a
      WHERE a.business_id = public.current_business_id()
    )
  );
