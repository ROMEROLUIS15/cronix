-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: schedule cron-imminent-push every 15 minutes via pg_cron + Vault.
--
-- Mirrors the pattern from 20260421170000_fix_cron_reminders_hourly.sql:
-- pg_cron reads the CRON_SECRET from Supabase Vault at execution time, so the
-- secret never lives in source. Vault entry "cron_secret" is provisioned
-- one-time in the Supabase Dashboard (already done for cron-reminders).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN PERFORM cron.unschedule('cron-imminent-push'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'cron-imminent-push',
  '*/15 * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://psuthbtdvprojdbsimvq.supabase.co/functions/v1/cron-imminent-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'cron_secret'
          LIMIT 1
        )
      ),
      body := '{}'
    ) AS request_id;
  $job$
);
