-- Migration: Fix cron-reminders schedule (daily → hourly) + Vault-based auth
--
-- WHY:
--   1. The previous activation migration (20260421120000) scheduled the job as
--      '0 0 * * *' (once daily at 00:00 UTC). But cron-reminders/index.ts calls
--      fn_get_businesses_at_hour(20), which requires hourly execution — otherwise
--      only businesses in the UTC-4 timezone ever get 8 PM reminders.
--   2. That migration also used current_setting('app.settings.cron_secret'),
--      which requires a manual `ALTER DATABASE ... SET ...`. On Supabase hosted
--      that statement is forbidden (ERROR 42501: permission denied). We migrate
--      the secret source to Supabase Vault, which is the officially supported path.
--
-- PREREQUISITE (one-time, via Supabase Dashboard → SQL Editor — NOT committed here
-- because it contains the secret value):
--
--   SELECT vault.create_secret('<paste CRON_SECRET value>', 'cron_secret');
--
-- The `cron_secret` vault entry must match the CRON_SECRET configured in
-- Supabase Dashboard → Edge Functions → Secrets (the same value that
-- cron-reminders/index.ts validates in the Authorization header).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule variants (safe if absent)
DO $$ BEGIN PERFORM cron.unschedule('cron-reminders-daily');  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('cron-reminders-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Schedule the hourly job; header reads the secret from Vault at execution time
SELECT cron.schedule(
  'cron-reminders-hourly',
  '0 * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://psuthbtdvprojdbsimvq.supabase.co/functions/v1/cron-reminders',
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
