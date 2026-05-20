-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: push hardening
--
-- 1) Tighten notification_subscriptions INSERT/UPDATE policies so a user can
--    only create/modify subscriptions whose business_id matches their own
--    (closes a cross-tenant write hole present since 20260324).
--
-- 2) Add a partial UNIQUE index on appointment_reminders that prevents two
--    'push_owner' sentinel rows for the same appointment — makes the
--    cron-imminent-push idempotency check race-proof at the DB level.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) Stricter RLS on notification_subscriptions ───────────────────────────
DROP POLICY IF EXISTS "notif_subs_insert_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_insert_own"
  ON public.notification_subscriptions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND business_id = (SELECT business_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "notif_subs_update_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_update_own"
  ON public.notification_subscriptions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND business_id = (SELECT business_id FROM public.users WHERE id = auth.uid())
  );

-- ── (2) DB-level idempotency for imminent-owner sentinel ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_imminent_owner
  ON public.appointment_reminders (appointment_id)
  WHERE channel = 'push_owner';
