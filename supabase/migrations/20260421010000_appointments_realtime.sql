-- Enable Realtime on public.appointments so the dashboard calendar receives
-- INSERT/UPDATE/DELETE events from the WhatsApp agent (which bypasses the UI).
-- Idempotent: ALTER PUBLICATION ADD TABLE throws if already present, so we guard it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END$$;
