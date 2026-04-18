-- 20260418000000_notifications_ttl.sql
-- Additive migration: agrega event_id (idempotencia) y expires_at (TTL 30 días)
-- NO re-crea la tabla — solo extiende el schema existente creado en 20260403233000_in_app_notifications.sql

-- event_id: clave de idempotencia para evitar duplicados de notificaciones.
-- Un eventId generado por crypto.randomUUID() en la app solo puede existir una vez.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '30 days');

-- Unique constraint: garantiza a nivel DB que event_id no se duplica.
-- IF NOT EXISTS no disponible para constraints — DO block para idempotencia segura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_event_id_key'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_event_id_key UNIQUE (event_id);
  END IF;
END $$;

-- Index para lookup rápido en el idempotency check del NotificationService.
CREATE INDEX IF NOT EXISTS idx_notifications_event_id
  ON public.notifications (event_id)
  WHERE event_id IS NOT NULL;

-- Index para limpieza periódica de notificaciones expiradas (cron job futuro).
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;
