-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: notifications INSERT policy
--
-- Bug preexistente: la tabla `notifications` tenía RLS habilitada con SELECT y
-- UPDATE policies, pero NINGUNA policy de INSERT. Eso hacía que cualquier
-- inserción desde el cliente (booking manual desde el dashboard, cancelación,
-- confirmación, etc.) fallara silenciosamente sin generar la fila — y por tanto
-- el bell jamás se actualizara. Las únicas notificaciones que sí entraban eran
-- las del pipeline WhatsApp/cron, que usan service_role y bypassan RLS.
--
-- Esta policy permite a un usuario insertar notificaciones únicamente para el
-- business al que pertenece, en línea con la SELECT/UPDATE ya existentes.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_insert_own_business" ON public.notifications;

CREATE POLICY "notifications_insert_own_business"
  ON public.notifications FOR INSERT
  WITH CHECK (
    business_id = (
      SELECT business_id FROM public.users WHERE id = auth.uid()
    )
  );
