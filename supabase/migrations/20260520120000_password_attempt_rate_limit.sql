-- ─────────────────────────────────────────────────────────────────────────────
-- Password Attempt Rate Limiting
-- Track failed password attempts; lock account after 3 failures
-- ─────────────────────────────────────────────────────────────────────────────

-- Create table to track failed password attempts
CREATE TABLE IF NOT EXISTS public.failed_password_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  business_id UUID,
  attempt_count INT NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for email (required for ON CONFLICT in fn_record_failed_password_attempt)
CREATE UNIQUE INDEX IF NOT EXISTS idx_failed_password_attempts_email
  ON public.failed_password_attempts(email);

-- Enable RLS (service_role bypasses it, but required for security compliance)
ALTER TABLE public.failed_password_attempts ENABLE ROW LEVEL SECURITY;

-- Deny all access (service_role functions handle access)
CREATE POLICY "deny_all" ON public.failed_password_attempts
  USING (false)
  WITH CHECK (false);

-- Create function to check and increment failed login attempts
CREATE OR REPLACE FUNCTION public.fn_check_password_attempts(
  p_email TEXT,
  MAX_ATTEMPTS INT DEFAULT 3,
  LOCKOUT_MINUTES INT DEFAULT 15
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result JSONB;
  v_current_attempt INT;
  v_is_locked BOOLEAN;
  v_locked_until TIMESTAMPTZ;
BEGIN
  -- Check if user has an active lockout
  SELECT attempt_count, locked_until
  INTO v_current_attempt, v_locked_until
  FROM public.failed_password_attempts
  WHERE email = p_email
  FOR UPDATE;

  -- If no record, user is clear
  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'allowed', true,
      'attempt_count', 0,
      'is_locked', false,
      'locked_until', NULL::TIMESTAMPTZ,
      'max_attempts', MAX_ATTEMPTS
    );
    RETURN v_result;
  END IF;

  -- Check if lockout period has expired
  IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
    v_result := jsonb_build_object(
      'allowed', false,
      'attempt_count', v_current_attempt,
      'is_locked', true,
      'locked_until', v_locked_until,
      'max_attempts', MAX_ATTEMPTS
    );
    RETURN v_result;
  END IF;

  -- If lockout expired, reset and allow login
  IF v_locked_until IS NOT NULL AND v_locked_until <= NOW() THEN
    UPDATE public.failed_password_attempts
    SET attempt_count = 0,
        locked_until = NULL,
        updated_at = NOW()
    WHERE email = p_email;

    v_result := jsonb_build_object(
      'allowed', true,
      'attempt_count', 0,
      'is_locked', false,
      'locked_until', NULL::TIMESTAMPTZ,
      'max_attempts', MAX_ATTEMPTS
    );
    RETURN v_result;
  END IF;

  -- Lockout not active; check if user still has attempts left
  IF v_current_attempt < MAX_ATTEMPTS THEN
    v_result := jsonb_build_object(
      'allowed', true,
      'attempt_count', v_current_attempt,
      'is_locked', false,
      'locked_until', NULL::TIMESTAMPTZ,
      'max_attempts', MAX_ATTEMPTS
    );
    RETURN v_result;
  ELSE
    v_result := jsonb_build_object(
      'allowed', false,
      'attempt_count', v_current_attempt,
      'is_locked', true,
      'locked_until', NOW() + (LOCKOUT_MINUTES || ' minutes')::INTERVAL,
      'max_attempts', MAX_ATTEMPTS
    );
    RETURN v_result;
  END IF;
END;
$$;

-- Create function to record a failed password attempt
CREATE OR REPLACE FUNCTION public.fn_record_failed_password_attempt(
  p_email TEXT,
  p_business_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result JSONB;
  v_current_attempt INT;
  v_should_lock BOOLEAN;
BEGIN
  -- Insert or update failed attempt record
  INSERT INTO public.failed_password_attempts (email, business_id, attempt_count, last_attempt_at)
  VALUES (p_email, p_business_id, 1, NOW())
  ON CONFLICT (email) DO UPDATE
  SET attempt_count = failed_password_attempts.attempt_count + 1,
      last_attempt_at = NOW(),
      updated_at = NOW()
  RETURNING attempt_count INTO v_current_attempt;

  -- Check if we should lock the account (3rd failed attempt)
  v_should_lock := v_current_attempt >= 3;

  IF v_should_lock THEN
    UPDATE public.failed_password_attempts
    SET locked_until = NOW() + INTERVAL '15 minutes'
    WHERE email = p_email;
  END IF;

  v_result := jsonb_build_object(
    'recorded', true,
    'attempt_count', v_current_attempt,
    'locked_after_this', v_should_lock,
    'locked_until', CASE WHEN v_should_lock THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
  );

  RETURN v_result;
END;
$$;

-- Create function to reset failed password attempts (called after successful login or password reset)
CREATE OR REPLACE FUNCTION public.fn_reset_password_attempts(
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.failed_password_attempts
  WHERE email = p_email;

  RETURN jsonb_build_object(
    'reset', true,
    'email', p_email
  );
END;
$$;

-- Permissions: service_role only (no anon, no authenticated)
REVOKE EXECUTE ON FUNCTION public.fn_check_password_attempts(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_password_attempts(TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_record_failed_password_attempt(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_failed_password_attempt(TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_reset_password_attempts(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reset_password_attempts(TEXT) TO service_role;
