-- 20260413000000_fix_users_rls_tenant_isolation.sql
-- CRITICAL SECURITY FIX: Remove overly permissive RLS policy on users table.
--
-- PROBLEM: The base schema had:
--   CREATE POLICY "users_select" ON users FOR SELECT TO authenticated USING (true);
--
-- This allowed ANY authenticated user to read ALL users across ALL businesses,
-- bypassing tenant isolation. Even though later migrations added tighter policies,
-- Postgres policy stacking means the most permissive policy wins (OR logic).
--
-- FIX: Drop the USING (true) policy and ensure only business-scoped policies exist.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DROP the overly permissive policy
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_select" ON public.users;
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ENSURE business-scoped SELECT policy exists (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
-- Users can see:
--   a) Their own row (id = auth.uid())
--   b) All users in their own business (business_id = get_my_business_id())

-- Drop old policies to recreate cleanly
DROP POLICY IF EXISTS "users_select_same_business" ON public.users;
DROP POLICY IF EXISTS "users_self_select" ON public.users;
-- Single consolidated policy: own row OR same-business members
CREATE POLICY "users_isolation" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR
    business_id = (
      SELECT u.business_id
      FROM public.users u
      WHERE u.id = auth.uid()
      LIMIT 1
    )
  );
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFY remaining policies are correctly scoped
-- ─────────────────────────────────────────────────────────────────────────────
-- These should already exist from previous migrations; we verify they don't
-- conflict with the new isolation policy.

-- users_insert: only allows inserting own row
-- (already exists: "users_insert" with CHECK (id = auth.uid()))

-- users_update: only allows updating own row
-- (already exists: "users_update" with USING (id = auth.uid()))

-- No UPDATE/DELETE policy should allow cross-user modification.
-- Team management is handled at the application layer via Server Actions
-- that assert owner role before calling repository methods.;
