-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add UNIQUE constraint on users.email
--
-- Prevents duplicate accounts with the same email address.
-- Combined with Supabase "Allow manual linking", ensures one user = one email.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Clean up any existing duplicates (keep the oldest row per email)
DELETE FROM public.users a
  USING public.users b
WHERE a.email = b.email
  AND a.email IS NOT NULL
  AND a.email <> ''
  AND a.created_at > b.created_at;

-- Step 2: Add unique constraint
ALTER TABLE public.users
  ADD CONSTRAINT users_email_unique UNIQUE (email);
