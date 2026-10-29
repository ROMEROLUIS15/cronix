-- 20261029140000_phone_agent_requests.sql
--
-- Idempotencia de las escrituras del agente telefónico (contrato §5): cada reserva llega con
-- una Idempotency-Key, el id de la propuesta que la persona confirmó. La primera vez se
-- ejecuta y se guarda la respuesta; la misma clave otra vez devuelve esa respuesta sin
-- reservar de nuevo; la misma clave con otro cuerpo es un error (IDEMPOTENCY_MISMATCH).
-- La fila se reclama antes de ejecutar (response NULL), así dos reintentos simultáneos no
-- reservan dos veces. Solo la service role la lee y escribe.

CREATE TABLE public.phone_agent_requests (
    call_sid        text NOT NULL REFERENCES public.phone_agent_calls(call_sid) ON DELETE CASCADE,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 64),
    request_hash    text NOT NULL,
    response        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (call_sid, idempotency_key)
);

ALTER TABLE public.phone_agent_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_agent_requests FROM anon, authenticated;
