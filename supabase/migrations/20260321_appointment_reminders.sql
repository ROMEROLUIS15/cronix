-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: appointment_reminders
-- Run this in Supabase Dashboard → SQL Editor, or via supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointment_reminders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  business_id     UUID        NOT NULL REFERENCES public.businesses(id)   ON DELETE CASCADE,
  remind_at       TIMESTAMPTZ NOT NULL,
  minutes_before  INT         NOT NULL DEFAULT 60,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','failed','cancelled')),
  channel         TEXT        NOT NULL DEFAULT 'whatsapp'
                              CHECK (channel IN ('whatsapp')),
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the cron job query: pending reminders due now
CREATE INDEX IF NOT EXISTS idx_reminders_cron
  ON public.appointment_reminders (status, remind_at)
  WHERE status = 'pending';

-- Index for appointment-scoped lookups (edit form, cancel)
CREATE INDEX IF NOT EXISTS idx_reminders_appointment
  ON public.appointment_reminders (appointment_id, status);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

-- Business staff can read reminders for their own business
CREATE POLICY "reminders_select_own_business"
  ON public.appointment_reminders FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Business staff can insert reminders for their own business
CREATE POLICY "reminders_insert_own_business"
  ON public.appointment_reminders FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Business staff can update (cancel) reminders for their own business
CREATE POLICY "reminders_update_own_business"
  ON public.appointment_reminders FOR UPDATE
  USING (
    business_id IN (
      SELECT business_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Business staff can delete pending reminders for their own business
CREATE POLICY "reminders_delete_own_business"
  ON public.appointment_reminders FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM public.users WHERE id = auth.uid()
    )
  );
