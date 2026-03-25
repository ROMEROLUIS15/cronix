-- ============================================================
-- Migration: Fix RLS policies for passkey_challenges + restrict users_select
--
-- CRITICAL: passkey_challenges had RLS enabled but ZERO policies,
-- meaning any authenticated user could read/write ALL challenges.
--
-- MEDIUM: users_select used USING(true), exposing all user profiles
-- (emails, phones, avatars) to any authenticated user. Replaced
-- with business-scoped visibility + self-access.
-- ============================================================

-- ── 1. passkey_challenges: user-scoped policies ─────────────────

CREATE POLICY "passkey_challenges_select_own"
  ON "public"."passkey_challenges"
  FOR SELECT
  USING ("user_id" = auth.uid());

CREATE POLICY "passkey_challenges_insert_own"
  ON "public"."passkey_challenges"
  FOR INSERT
  WITH CHECK ("user_id" = auth.uid());

CREATE POLICY "passkey_challenges_delete_own"
  ON "public"."passkey_challenges"
  FOR DELETE
  USING ("user_id" = auth.uid());

-- ── 2. users: restrict SELECT from USING(true) to scoped ───────

-- Drop the overly-permissive policy
DROP POLICY IF EXISTS "users_select" ON "public"."users";

-- Replace with business-scoped visibility:
-- Users can see other members of their own business (needed for team, assignment dropdowns)
-- plus always see themselves (self-select policy already exists).
CREATE POLICY "users_select_same_business"
  ON "public"."users"
  FOR SELECT
  USING (
    "business_id" IN (
      SELECT "business_id" FROM "public"."users" WHERE "id" = auth.uid()
    )
    OR "id" = auth.uid()
  );
