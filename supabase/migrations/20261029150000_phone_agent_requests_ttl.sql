-- 20261029150000_phone_agent_requests_ttl.sql
--
-- Las respuestas guardadas por Idempotency-Key se conservan 7 días (contrato del agente
-- telefónico §3, §5): basta para cualquier reintento dentro de una llamada y no acumula
-- filas para siempre. Un job diario de pg_cron borra las más viejas.

CREATE INDEX IF NOT EXISTS phone_agent_requests_created_at_idx
    ON public.phone_agent_requests (created_at);

SELECT cron.schedule(
  'phone-agent-requests-ttl',
  '30 4 * * *',  -- 04:30 UTC diariamente
  $job$ DELETE FROM public.phone_agent_requests WHERE created_at < now() - interval '7 days' $job$
);
