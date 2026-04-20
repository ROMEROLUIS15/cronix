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
-- Helper function with SECURITY DEFINER to avoid infinite recursion.
-- A policy on `users` cannot sub-SELECT from `users` without triggering
-- the same policy again. SECURITY DEFINER runs as the function owner
-- (postgres), bypassing RLS for this single lookup.
CREATE OR REPLACE FUNCTION public.get_my_business_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT business_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;
-- Replace with business-scoped visibility:
-- Users can see other members of their own business (needed for team, assignment dropdowns)
-- plus always see themselves.
CREATE POLICY "users_select_same_business"
  ON "public"."users"
  FOR SELECT
  USING (
    id = auth.uid()
    OR business_id = public.get_my_business_id()
  );
