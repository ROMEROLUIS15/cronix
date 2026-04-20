-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: optimize_indexes
-- Adds missing indexes on FK columns used in JOINs, RLS, and filtered queries.
-- Drops duplicate indexes that waste write I/O.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Missing FK indexes ────────────────────────────────────────────────────

-- appointments.assigned_user_id — JOINs in getMonthAppointments/getDayAppointments,
-- COUNT check in deleteEmployee, and FK cascade performance.
CREATE INDEX IF NOT EXISTS idx_appointments_assigned_user
  ON public.appointments (assigned_user_id);
-- appointment_reminders.business_id — evaluated on every query by RLS policy:
-- "business_id IN (SELECT business_id FROM users WHERE id = auth.uid())"
CREATE INDEX IF NOT EXISTS idx_reminders_business
  ON public.appointment_reminders (business_id);
-- transactions.appointment_id — FK used in JOINs when fetching client
-- appointment history: appointments → transactions(net_amount, amount)
CREATE INDEX IF NOT EXISTS idx_transactions_appointment
  ON public.transactions (appointment_id);
-- user_passkeys.user_id — RLS policy "auth.uid() = user_id" runs on every
-- SELECT in the passkey profile section.
CREATE INDEX IF NOT EXISTS idx_passkeys_user
  ON public.user_passkeys (user_id);
-- ── 2. Remove duplicate indexes ──────────────────────────────────────────────

-- idx_appointments_client and idx_appointments_client_id are both B-tree
-- on (client_id) — keep idx_appointments_client_id, drop the other.
DROP INDEX IF EXISTS public.idx_appointments_client;
-- idx_users_business and idx_users_business_id are both B-tree
-- on (business_id) — keep idx_users_business_id, drop the other.
DROP INDEX IF EXISTS public.idx_users_business;
