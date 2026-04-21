-- Migration: Activate cron-reminders daily job
-- Runs cron-reminders edge function every day at 12:00 AM UTC
-- The function finds businesses at 8 PM local time and sends:
--   1. WhatsApp reminders to clients with tomorrow's appointments
--   2. Summary message to business owner with all tomorrow's appointments
--
-- Requires: CRON_SECRET env var must be set in Supabase Settings

SELECT cron.schedule(
  'cron-reminders-daily',
  '0 0 * * *',
  $$
    SELECT net.http_post(
      url := 'https://psuthbtdvprojdbsimvq.supabase.co/functions/v1/cron-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
      ),
      body := '{}'
    ) AS request_id;
  $$
);
