-- 20261125120000_phone_agent_calls_whatsapp.sql
--
-- Llamadas de WhatsApp en phone-agent-api (contrato §4.1, §4.1b). Aditiva: ninguna fila
-- existente cambia (todas son 'twilio', con negocio e identity_verified = false).
--
-- 1. channel acepta 'whatsapp'.
-- 2. business_id puede quedar NULL solo en una llamada de WhatsApp, mientras el cliente
--    no dice el negocio (ni la sesión ni su teléfono lo decidieron); se fija una sola vez
--    con POST /v1/calls/{call_sid}/business. La línea telefónica sigue exigiendo negocio.
-- 3. identity_verified solo puede ser true en WhatsApp (Meta verifica el número; el caller
--    ID de la línea telefónica se puede falsear).
--
-- Idempotente: cada CHECK se borra si existe y se vuelve a crear.

ALTER TABLE public.phone_agent_calls DROP CONSTRAINT IF EXISTS phone_agent_calls_channel_check;
ALTER TABLE public.phone_agent_calls
    ADD CONSTRAINT phone_agent_calls_channel_check CHECK (channel IN ('twilio', 'whatsapp'));

ALTER TABLE public.phone_agent_calls ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE public.phone_agent_calls DROP CONSTRAINT IF EXISTS phone_agent_calls_business_required_check;
ALTER TABLE public.phone_agent_calls
    ADD CONSTRAINT phone_agent_calls_business_required_check CHECK (business_id IS NOT NULL OR channel = 'whatsapp');

ALTER TABLE public.phone_agent_calls DROP CONSTRAINT IF EXISTS phone_agent_calls_identity_verified_check;
ALTER TABLE public.phone_agent_calls
    ADD CONSTRAINT phone_agent_calls_identity_verified_check CHECK (NOT identity_verified OR channel = 'whatsapp');
