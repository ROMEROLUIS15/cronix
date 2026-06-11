-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the redundant raw-phone uniqueness constraint on clients.
--
-- Background:
--   `clients_business_phone_unique_key` UNIQUE (business_id, phone) was added in
--   20260325160000 to support `fn_book_appointment_wa`'s old
--   `ON CONFLICT (business_id, phone)` upsert. That RPC was rewritten in
--   20260516000000 to a SELECT-then-INSERT keyed on the normalised `phone_digits`
--   column, so the raw-phone constraint no longer has any caller.
--
--   It now coexists with `idx_clients_business_phone_digits` (the partial unique
--   index on normalised digits, deleted_at-aware). Having two mechanisms means:
--     1. Duplicate inserts can trip the legacy constraint first, leaking its raw
--        Postgres name to the UI (the dashboard's friendly-error mapping only
--        knows the idx_* names).
--     2. The legacy constraint blocks re-registering a phone whose previous row
--        was soft-deleted (no deleted_at predicate), contradicting the intended
--        soft-delete semantics.
--
-- This migration removes the legacy constraint, leaving `idx_clients_business_phone_digits`
-- as the single source of truth for per-business phone uniqueness. The digits
-- index is strictly tighter (normalises formatting) and respects soft-deletes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_business_phone_unique_key;
