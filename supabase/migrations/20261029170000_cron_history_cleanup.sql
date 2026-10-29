-- 20261029170000_cron_history_cleanup.sql
--
-- Limpieza diaria del historial de pg_cron y chequeo de tasa de errores cada hora.
--
-- cron.job_run_details guarda una fila por cada ejecución de cada job y nunca se
-- limpiaba: llegó a 20 MB, un tercio de la base, y cada ejecución la escribe y la
-- actualiza. En la instancia Nano eso consume el presupuesto de Disk IO, que se
-- agotó el 2026-10-29 y dejó la base sin responder. Se conserva una semana; con
-- eso la tabla queda chica y la limpieza no necesita índice (la tabla es de pg_cron).
--
-- check_ai_agent_error_rate() ya evalúa una ventana de 60 minutos con 60 de
-- cooldown: correrlo cada hora en vez de cada 15 minutos no cambia lo que detecta
-- y escribe cuatro veces menos.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'cron-job-run-details-cleanup',
  '15 4 * * *',  -- 04:15 UTC diariamente
  $job$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days' $job$
);

SELECT cron.alter_job(jobid, schedule := '0 * * * *')
FROM cron.job
WHERE jobname = 'ai-agent-error-rate-check';
