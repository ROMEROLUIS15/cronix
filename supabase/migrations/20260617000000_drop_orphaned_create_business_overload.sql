-- 20260617000000_drop_orphaned_create_business_overload.sql
--
-- BUG: Google sign-ups could not create a business from /dashboard/setup.
--
-- ROOT CAUSE: migration 20260504100000_referral_system.sql redefined
-- fn_create_business_and_link_owner with CREATE OR REPLACE FUNCTION but ADDED a
-- new parameter (p_referral_code TEXT DEFAULT NULL). In PostgreSQL, changing the
-- argument list of CREATE OR REPLACE creates a *new overload* instead of
-- replacing the old one, so two functions coexisted:
--
--   (uuid,text,text,text,text,text,text)        -- 7 args, orphaned (20260420000001)
--   (uuid,text,text,text,text,text,text,text)   -- 8 args, current (referral system)
--
-- SupabaseBusinessRepository.createWithOwnerLink() calls the RPC with exactly 7
-- named args. Both overloads are valid candidates (the 8-arg one matches because
-- p_referral_code has a default), so PostgREST cannot disambiguate and returns
-- PGRST203 "Could not choose the best candidate function". The INSERT never runs.
--
-- Only Google OAuth users hit this: email sign-ups carry biz_name in user
-- metadata and the auth callback auto-creates the business via a plain
-- businesses.create() insert (no RPC). Google users have no biz_name, so the
-- setup form — the sole caller of this RPC — is the only path that fails.
--
-- FIX: drop the orphaned 7-arg overload. The 8-arg version is a strict superset
-- (identical behaviour plus optional referral handling), so the 7-arg named-arg
-- call resolves unambiguously to it. Same class of fix as
-- 20260604000000_fix_dead_function_overload.sql.

DROP FUNCTION IF EXISTS public.fn_create_business_and_link_owner(
  uuid, text, text, text, text, text, text
);
