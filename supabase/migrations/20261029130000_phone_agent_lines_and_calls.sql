-- 20261029130000_phone_agent_lines_and_calls.sql
--
-- Agente telefónico (phone-agent-api): qué línea es de qué negocio y el registro de cada
-- llamada. Las lee y escribe solo la Edge Function con la service role: RLS activa sin
-- políticas, así ningún usuario del dashboard ni anon puede leerlas ni escribirlas.
--
-- phone_agent_lines: un número marcado pertenece a un solo negocio (PK). Se cargan con SQL
-- al comprar un número; no hay pantalla.
-- phone_agent_calls: el negocio de cada llamada sale de aquí, nunca del cuerpo de una
-- request. identity_verified es false en la línea telefónica (el caller ID se puede falsear).

CREATE TABLE public.phone_agent_lines (
    phone_digits text PRIMARY KEY CHECK (phone_digits ~ '^[0-9]{8,15}$'),
    business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_agent_lines_business_id_idx ON public.phone_agent_lines (business_id);

CREATE TABLE public.phone_agent_calls (
    call_sid          text PRIMARY KEY CHECK (length(call_sid) BETWEEN 1 AND 64),
    business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    channel           text NOT NULL CHECK (channel IN ('twilio')),
    caller_phone      text,
    identity_verified boolean NOT NULL DEFAULT false,
    outcome           text CHECK (outcome IN (
                          'booked', 'rescheduled', 'cancelled', 'message_taken', 'info_only', 'abandoned'
                      )),
    started_at        timestamptz NOT NULL DEFAULT now(),
    ended_at          timestamptz
);
CREATE INDEX phone_agent_calls_business_started_idx
    ON public.phone_agent_calls (business_id, started_at DESC);

ALTER TABLE public.phone_agent_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_agent_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_agent_lines FROM anon, authenticated;
REVOKE ALL ON public.phone_agent_calls FROM anon, authenticated;
