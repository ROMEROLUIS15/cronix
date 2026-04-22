-- Enable Realtime on public.notifications so the notification bell updates automatically
-- without requiring the PWA to be reloaded.
-- Idempotent: ALTER PUBLICATION ADD TABLE throws if already present, so we guard it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END$$;
