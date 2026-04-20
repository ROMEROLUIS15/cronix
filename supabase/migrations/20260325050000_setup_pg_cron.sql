-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: pg_cron setup para cron-reminders
-- Ejecuta cron-reminders Edge Function diariamente a las 12:00 AM UTC
--
-- Requiere: pg_cron extension (habilitada por Supabase por defecto)
-- Run: supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

-- Asegura que pg_cron está habilitada
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Configura la zona horaria para el cron job
-- (cron funciona en UTC; puedes cambiar a tu zona)

-- ── Cron job: ejecuta cron-reminders EF cada día a medianoche ────────────
-- Usar net.http_post() para llamar la Edge Function con el CRON_SECRET

-- IMPORTANTE: esta línea debe ejecutarse MANUALMENTE en la Supabase Dashboard
-- porque requiere acceso a secrets() que no está disponible en migraciones.
--
-- Opción 1 (RECOMENDADO): Dashboard SQL Editor
-- ────────────────────────────────────────────
-- Pega esto directamente en SQL Editor y ejecuta:
/*
SELECT cron.schedule(
  'cron-reminders-daily',
  '0 0 * * *',  -- 12:00 AM UTC diariamente
  $$
    SELECT net.http_post(
      url := concat(current_setting('app.settings.supabase_url'), '/functions/v1/cron-reminders'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret')
      ),
      body := '{}'
    ) AS request_id;
  $$
);
*/

-- Opción 2: Si quieres usar variables de entorno en la migración, descomenta esto:
-- (Pero requiere que las variables estén disponibles en Supabase Dashboard)
/*
DO $$
DECLARE
  v_supabase_url TEXT := current_setting('app.settings.supabase_url', true) OR 'https://psuthbtdvprojdbsimvq.supabase.co';
  v_cron_secret TEXT := current_setting('app.settings.cron_secret', true) OR '';
BEGIN
  IF v_cron_secret = '' THEN
    RAISE WARNING 'CRON_SECRET not configured in app.settings';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'cron-reminders-daily',
    '0 0 * * *',
    format($$
      SELECT net.http_post(
        url := '%s/functions/v1/cron-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{}'
      ) AS request_id;
    $$, v_supabase_url, v_cron_secret)
  );

  RAISE NOTICE 'Cron job "cron-reminders-daily" scheduled successfully';
END $$;
*/

-- ── Verificación: listar todos los cron jobs ──────────────────────────────
-- Ejecuta esto para verificar que el job está activo:
-- SELECT * FROM cron.job;;
