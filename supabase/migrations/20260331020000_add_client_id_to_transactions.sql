-- Agrega ref a cliente directo en pagos para permitir registrar deudas sin citas

ALTER TABLE public.transactions
ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

-- Llenamos los pagos existentes que tengan appointment_id
UPDATE public.transactions t
SET client_id = a.client_id
FROM public.appointments a
WHERE t.appointment_id = a.id
  AND t.appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON public.transactions(client_id);
