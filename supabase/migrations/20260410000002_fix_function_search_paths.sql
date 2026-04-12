-- ─────────────────────────────────────────────────────────────────────────────
-- Fix search_path on critical functions and move extensions
-- Goal: Set explicit search_path to prevent schema hijacking.
-- Also moves public extensions to the 'extensions' schema for hardening.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

ALTER FUNCTION public.protect_platform_admin_role()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.fn_validate_appointment_date()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.match_memories(query_embedding vector, match_threshold double precision, match_count integer, p_user_id uuid, p_business_id uuid)
  SET search_path = extensions, public, pg_catalog;
