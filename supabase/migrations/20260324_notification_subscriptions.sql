-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: notification_subscriptions (Web Push / VAPID)
-- Stores browser PushSubscription objects per user.
-- Multi-tenant: each subscription is scoped to a user + business.
--
-- Run: supabase db push  OR  Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership — strict multi-tenant isolation
  user_id     UUID        NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  business_id UUID        NOT NULL REFERENCES public.businesses(id)  ON DELETE CASCADE,

  -- PushSubscription fields (from sub.toJSON())
  endpoint    TEXT        NOT NULL,
  p256dh      TEXT        NOT NULL,   -- subscriber public key (base64url)
  auth        TEXT        NOT NULL,   -- auth secret (base64url)

  -- Diagnostics
  user_agent  TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One subscription per (user, endpoint) — handles browser refresh
  CONSTRAINT uq_user_endpoint UNIQUE (user_id, endpoint)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- push-notify queries by business_id to fan out notifications
CREATE INDEX IF NOT EXISTS idx_notif_subs_business
  ON public.notification_subscriptions (business_id);

-- user-scoped lookups (hook checks if user is already subscribed)
CREATE INDEX IF NOT EXISTS idx_notif_subs_user
  ON public.notification_subscriptions (user_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.notification_subscriptions ENABLE ROW LEVEL SECURITY;

-- SELECT: users see only their own subscriptions
DROP POLICY IF EXISTS "notif_subs_select_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_select_own"
  ON public.notification_subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: users can only insert subscriptions for themselves
DROP POLICY IF EXISTS "notif_subs_insert_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_insert_own"
  ON public.notification_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE: users can only update their own subscriptions
DROP POLICY IF EXISTS "notif_subs_update_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_update_own"
  ON public.notification_subscriptions FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: users can only remove their own subscriptions
DROP POLICY IF EXISTS "notif_subs_delete_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_delete_own"
  ON public.notification_subscriptions FOR DELETE
  USING (user_id = auth.uid());

-- ── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_subs_updated_at ON public.notification_subscriptions;
CREATE TRIGGER trg_notif_subs_updated_at
  BEFORE UPDATE ON public.notification_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
