-- ============================================================================
-- Migration: Referral System Base Schema & Logic
-- ============================================================================

-- 1. Add columns to businesses
ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by_id UUID REFERENCES public.businesses(id),
ADD COLUMN IF NOT EXISTS bonus_appointments_limit INTEGER DEFAULT 0;

-- 2. Index for listing invited businesses by referrer (used in referrals page query)
CREATE INDEX IF NOT EXISTS idx_businesses_referred_by_id
  ON public.businesses (referred_by_id)
  WHERE referred_by_id IS NOT NULL;

-- 3. Populate referral codes for existing businesses
UPDATE public.businesses
SET referral_code = substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8)
WHERE referral_code IS NULL;

-- 3. Replace fn_create_business_and_link_owner to handle referrals
CREATE OR REPLACE FUNCTION public.fn_create_business_and_link_owner(
  p_owner_id    UUID,
  p_owner_name  TEXT,
  p_owner_email TEXT,
  p_name        TEXT,
  p_category    TEXT,
  p_timezone    TEXT,
  p_plan        TEXT,
  p_referral_code TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_slug        TEXT;
  v_my_referral_code TEXT;
  v_referrer_id UUID := NULL;
  v_referrer_plan business_plan;
BEGIN
  -- Security: caller must be creating their own account
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))
    || '-' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 6);

  v_my_referral_code := substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8);

  -- Handle referral logic
  IF p_referral_code IS NOT NULL AND p_referral_code != '' THEN
    SELECT id, plan INTO v_referrer_id, v_referrer_plan
    FROM public.businesses
    WHERE referral_code = p_referral_code;

    -- If referrer exists and is Free, grant Dropbox model bonus (+10 appts, capped at 50 extra)
    IF v_referrer_id IS NOT NULL AND v_referrer_plan = 'free'::business_plan THEN
      UPDATE public.businesses
      SET bonus_appointments_limit = LEAST(bonus_appointments_limit + 10, 50)
      WHERE id = v_referrer_id;
    END IF;
  END IF;

  -- 1. Insert business atomically
  INSERT INTO public.businesses (name, category, owner_id, plan, timezone, slug, referral_code, referred_by_id)
  VALUES (p_name, p_category, p_owner_id, p_plan::business_plan, p_timezone, v_slug, v_my_referral_code, v_referrer_id)
  RETURNING id INTO v_business_id;

  -- 2. Link user to business
  UPDATE public.users
  SET
    name        = p_owner_name,
    email       = p_owner_email,
    business_id = v_business_id,
    role        = 'owner'::user_role,
    status      = 'active'::user_status
  WHERE id = p_owner_id;

  -- 3. Grant welcome bonus to the invited user (if they used a code and start on Free)
  IF v_referrer_id IS NOT NULL AND p_plan = 'free' THEN
    UPDATE public.businesses
    SET bonus_appointments_limit = 10
    WHERE id = v_business_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'business_id', v_business_id);
END;
$$;
