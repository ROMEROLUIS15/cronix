-- 20261029120000_drop_unused_fn_get_available_slots.sql
--
-- fn_get_available_slots (dos overloads) calculaba las horas libres en SQL con reglas
-- distintas a las del resto: no descartaba horas pasadas, sin horario configurado no daba
-- ninguna, y contaba como ocupadas las citas no_show. Ningún código la llama: WhatsApp, el
-- agente de voz del dashboard y el agente telefónico calculan con
-- supabase/functions/_shared/availability.ts, la misma regla de estados que
-- fn_book_appointment_wa. Se elimina para que haya un solo cálculo.

DROP FUNCTION IF EXISTS public.fn_get_available_slots(uuid, date, uuid);
DROP FUNCTION IF EXISTS public.fn_get_available_slots(uuid, date, uuid, text);
