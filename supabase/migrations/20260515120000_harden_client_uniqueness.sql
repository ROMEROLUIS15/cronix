-- ─────────────────────────────────────────────────────────────────────────────
-- Harden client uniqueness per business: phone (normalised) AND email.
--
-- Background:
--   Migration 20260412000001 added `clients.phone_digits` (GENERATED, normalised)
--   and a partial unique index on (business_id, phone_digits). In production we
--   still observed duplicates with phones like "+58 4247092980" and
--   "584247092980" — both normalise to "584247092980" and should have collided.
--   The duplicates likely predate the index OR the index was lost in a later
--   migration. This migration cleans the slate and locks both phone and email
--   per business going forward, so the voice-worker / dashboard can keep doing
--   soft-deletes and a recreated client with the same identity is impossible
--   while the original row is active.
--
-- What this migration does:
--   1. Soft-delete duplicate active clients by `phone_digits` (keep oldest).
--   2. Recreate the partial unique index on phone_digits (idempotent + tighter
--      predicate that also excludes empty strings).
--   3. Add a GENERATED `email_norm` column (lowercased + trimmed, NULL when
--      empty) so case/whitespace variations collide.
--   4. Soft-delete duplicate active clients by `email_norm` (keep oldest).
--   5. Create a partial unique index on (business_id, email_norm).
--
-- Soft-delete semantics: setting deleted_at=now() preserves the appointments
-- FK link (history is intact) AND removes the row from the partial index, so a
-- new client with the same phone/email can be registered later.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clean duplicate active phones (keep oldest by created_at)
UPDATE public.clients a
SET deleted_at = NOW()
FROM public.clients b
WHERE a.business_id   = b.business_id
  AND a.phone_digits  = b.phone_digits
  AND a.phone_digits IS NOT NULL
  AND a.phone_digits <> ''
  AND a.deleted_at   IS NULL
  AND b.deleted_at   IS NULL
  AND a.created_at    > b.created_at;
-- 2. Re-create partial unique index on phone_digits (idempotent, tighter)
DROP INDEX IF EXISTS public.idx_clients_business_phone_digits;
CREATE UNIQUE INDEX idx_clients_business_phone_digits
  ON public.clients (business_id, phone_digits)
  WHERE phone_digits IS NOT NULL
    AND phone_digits <> ''
    AND deleted_at  IS NULL;
-- 3. email_norm GENERATED column (lowercase + trim, NULL when empty)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS email_norm text GENERATED ALWAYS AS (
    NULLIF(LOWER(BTRIM(email)), '')
  ) STORED;
-- 4. Clean duplicate active emails (keep oldest by created_at)
UPDATE public.clients a
SET deleted_at = NOW()
FROM public.clients b
WHERE a.business_id  = b.business_id
  AND a.email_norm   = b.email_norm
  AND a.email_norm  IS NOT NULL
  AND a.deleted_at  IS NULL
  AND b.deleted_at  IS NULL
  AND a.created_at   > b.created_at;
-- 5. Partial unique index on email_norm (active clients per business)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_business_email_norm
  ON public.clients (business_id, email_norm)
  WHERE email_norm IS NOT NULL AND deleted_at IS NULL;
