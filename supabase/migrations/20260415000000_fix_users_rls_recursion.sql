-- 20260415000000_fix_users_rls_recursion.sql
--
-- PROBLEM: Migration 20260413 created "users_isolation" using a raw correlated
-- subquery on the users table itself:
--
--   business_id = (SELECT u.business_id FROM public.users u WHERE u.id = auth.uid())
--
-- PostgreSQL evaluates this subquery by scanning users, which triggers the same
-- policy, which fires the subquery again → infinite recursion.
--
-- Migration 20260414 introduced current_business_id() (SECURITY DEFINER) to solve
-- exactly this class of bug on all other tables, but explicitly skipped users:
--   "users_select_same_business already uses get_my_business_id(). No change needed."
-- That comment was wrong — users_isolation was still using the raw subquery.
--
-- FIX: Replace the recursive subquery with current_business_id() (SECURITY DEFINER).
-- SECURITY DEFINER functions run as their owner (postgres), bypassing RLS internally,
-- so the SELECT inside the function does not trigger users_isolation → no recursion.
--
-- BEHAVIOUR after fix:
--   platform_admin  → sees only own row (current_business_id() returns NULL, NULL = NULL is false)
--   owner/employee  → sees own row + all teammates in same business

BEGIN;
-- Drop the policy that introduced the recursion
DROP POLICY IF EXISTS "users_isolation" ON public.users;
-- Recreate with current_business_id() — identical semantics, zero recursion
CREATE POLICY "users_isolation" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR
    business_id = public.current_business_id()
  );
COMMIT;
