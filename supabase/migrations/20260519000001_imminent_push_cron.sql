-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: imminent push channel + pg_cron schedule
-- - Allows 'push_owner' as a sentinel channel on appointment_reminders so the
--   cron-imminent-push edge function can mark appointments as already-pushed.
-- - Schedules the edge function to run every 15 minutes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointment_reminders
  DROP CONSTRAINT IF EXISTS appointment_reminders_channel_check;

ALTER TABLE public.appointment_reminders
  ADD CONSTRAINT appointment_reminders_channel_check
  CHECK (channel IN ('whatsapp', 'push_owner'));

-- ── pg_cron schedule — run MANUALLY in Supabase Dashboard SQL Editor ─────────
-- (pg_cron needs app.settings.* which are not available inside migrations.)
--
-- SELECT cron.schedule(
--   'cron-imminent-push',
--   '*/15 * * * *',
--   $$
--     SELECT net.http_post(
--       url := concat(current_setting('app.settings.supabase_url'), '/functions/v1/cron-imminent-push'),
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
--       ),
--       body := '{}'
--     ) AS request_id;
--   $$
-- );
