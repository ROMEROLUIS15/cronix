-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: schedule the daily win-back run via pg_cron + Vault (NOT YET APPLIED).
--
-- Spec: docs/specs/modulo-retencion/manifest.md §6.
--
-- Enfoque A (decidido con el dueño): el use-case vive en Node (Next/Vercel), así
-- que pg_cron dispara la ROUTE Next `/api/cron/retention` (no un edge function).
-- La route corre ProcessRetentionUseCase para cada negocio Pro+ con el toggle ON.
--
-- Auth: Bearer CRON_SECRET, leído desde Supabase Vault en tiempo de ejecución
-- (mismo patrón que cron-imminent-push) — el secreto nunca vive en el código.
-- Requisitos one-time (ops, fuera de esta migración):
--   1. Vault entry "cron_secret" provisto (ya existe para los otros crons).
--   2. CRON_SECRET configurado como env var en Vercel (lo valida la route).
--   3. Confirmar el dominio de producción de la app (abajo).
--
-- Cadencia: 1×/día a las 14:00 UTC ≈ 9:00 AM en America/Bogota (hora razonable
-- para el mercado objetivo; el gating per-negocio por hora local queda para v2).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN PERFORM cron.unschedule('cron-retention-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'cron-retention-daily',
  '0 14 * * *',
  $job$
    SELECT net.http_post(
      url := 'https://cronix-app.vercel.app/api/cron/retention',
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
