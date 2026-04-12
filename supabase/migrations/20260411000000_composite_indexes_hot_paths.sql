-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: composite_indexes_hot_paths
-- Created: 2026-04-11
-- Purpose: Composite indexes for the most frequent query patterns in Cronix.
--
-- Single-column FK indexes exist (from prior migrations) but every calendar/AI
-- query filters by (business_id AND start_at) or (business_id AND status).
-- A composite index lets Postgres satisfy these in one B-tree seek.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. appointments ─────────────────────────────────────────────────────────
-- Pattern: .eq('business_id', X).gte('start_at', Y).lte('start_at', Z).order('start_at')
-- Used in: getMonthAppointments, getDayAppointments, findByDateRange, getDaySlots
-- AI tools: get_upcoming_gaps, book_appointment (conflict check)
CREATE INDEX IF NOT EXISTS idx_appts_biz_start
  ON public.appointments (business_id, start_at);

-- Pattern: .eq('business_id', X).in('status', [...]).lt('start_at', Y).gt('end_at', Z)
-- Used in: findConflicts (double-booking prevention)
-- INCLUDE adds start_at/end_at to the index leaf → index-only scan (no heap fetch)
CREATE INDEX IF NOT EXISTS idx_appts_biz_status_times
  ON public.appointments (business_id, status)
  INCLUDE (start_at, end_at)
  WHERE status IN ('pending', 'confirmed');

-- Pattern: .eq('business_id', X).eq('client_id', Y).in('status', [...]).gte('start_at', Z)
-- Used in: findUpcomingByClient (AI booking flow)
CREATE INDEX IF NOT EXISTS idx_appts_client_upcoming
  ON public.appointments (business_id, client_id, start_at)
  WHERE status IN ('pending', 'confirmed');

-- ── 2. clients ──────────────────────────────────────────────────────────────
-- Pattern: .eq('business_id', X).is('deleted_at', null).order('name')
-- Used in: getAll, getAllForSelect, findActiveForAI
-- Partial index excludes soft-deleted rows → smaller index, faster scans
CREATE INDEX IF NOT EXISTS idx_clients_biz_name_active
  ON public.clients (business_id, name)
  WHERE deleted_at IS NULL;

-- Pattern: .eq('business_id', X).is('deleted_at', null)  (AI fuzzy match by phone)
-- Used in: findActiveForAI (phone-based lookup)
CREATE INDEX IF NOT EXISTS idx_clients_biz_phone_active
  ON public.clients (business_id, phone)
  WHERE deleted_at IS NULL;

-- ── 3. transactions ─────────────────────────────────────────────────────────
-- Pattern: .eq('business_id', X).gte('paid_at', Y).lte('paid_at', Z)
-- Used in: findByPaidAtRange, getDashboardStats (monthly revenue)
CREATE INDEX IF NOT EXISTS idx_tx_biz_paid_at
  ON public.transactions (business_id, paid_at);

-- Pattern: .eq('business_id', X).order('paid_at', { ascending: false })
-- Used in: getTransactions (list recent)
CREATE INDEX IF NOT EXISTS idx_tx_biz_paid_at_desc
  ON public.transactions (business_id, paid_at DESC);

-- ── 4. appointment_reminders ────────────────────────────────────────────────
-- Pattern: .eq('business_id', X).eq('status', 'pending').gte('remind_at', Y)
-- Used in: cron-reminders Edge Function
CREATE INDEX IF NOT EXISTS idx_reminders_pending_due
  ON public.appointment_reminders (business_id, remind_at)
  WHERE status = 'pending';

-- ── 5. users ────────────────────────────────────────────────────────────────
-- Pattern: .eq('id', X).single()  →  then check business_id
-- Already covered by PK, but status checks in middleware need:
-- .eq('id', X) → get status
CREATE INDEX IF NOT EXISTS idx_users_id_status
  ON public.users (id) INCLUDE (status, business_id);

COMMIT;
