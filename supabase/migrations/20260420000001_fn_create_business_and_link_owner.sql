-- ============================================================================
-- Migration: Atomic business creation + owner linking
--
-- Replaces the two-step pattern in setup/actions.ts:
--   Step 1: INSERT businesses  (could succeed)
--   Step 2: UPDATE users       (could fail → orphaned business)
--
-- Now both operations are wrapped in a single PostgreSQL transaction.
-- SECURITY DEFINER is required to bypass RLS on the users table
-- (same pattern used by fn_book_appointment_wa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_create_business_and_link_owner(
  p_owner_id    UUID,
  p_owner_name  TEXT,
  p_owner_email TEXT,
  p_name        TEXT,
  p_category    TEXT,
  p_timezone    TEXT,
  p_plan        TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_slug        TEXT;
BEGIN
  -- Security: caller must be creating their own account
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Generate URL-safe slug matching TypeScript generateBusinessSlug format:
  -- lower-kebab-name + 6 random hex chars
  v_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))
    || '-' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 6);

  -- 1. Insert business atomically
  INSERT INTO public.businesses (name, category, owner_id, plan, timezone, slug)
  VALUES (p_name, p_category, p_owner_id, p_plan::business_plan, p_timezone, v_slug)
  RETURNING id INTO v_business_id;

  -- 2. Link user to business — SECURITY DEFINER bypasses RLS on users table
  UPDATE public.users
  SET
    name        = p_owner_name,
    email       = p_owner_email,
    business_id = v_business_id,
    role        = 'owner'::user_role,
    status      = 'active'::user_status
  WHERE id = p_owner_id;

  RETURN jsonb_build_object('success', true, 'business_id', v_business_id);
END;
$$;
