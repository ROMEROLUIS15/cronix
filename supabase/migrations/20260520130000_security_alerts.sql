-- ─────────────────────────────────────────────────────────────────────────────
-- Security Alerts Table
-- Track security incidents: lockouts, suspicious activity, etc.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE security_alert_type AS ENUM (
  'password_lockout_threshold',
  'suspicious_ip',
  'suspicious_user_agent',
  'credential_stuffing_detected',
  'account_recovery_attempted',
  'unusual_login_location'
);

CREATE TYPE alert_severity AS ENUM (
  'none',
  'warning',
  'critical',
  'immediate_review'
);

CREATE TABLE IF NOT EXISTS public.security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  alert_type security_alert_type NOT NULL,
  severity alert_severity NOT NULL,
  user_email TEXT NOT NULL,
  lockout_count_24h INT,
  ip_address INET,
  user_agent TEXT,
  recommended_action TEXT,
  status TEXT DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'reviewed', 'resolved', 'ignored')),
  reviewed_by UUID REFERENCES public.users(id),
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_security_alerts_email
  ON public.security_alerts(user_email);

CREATE INDEX IF NOT EXISTS idx_security_alerts_status
  ON public.security_alerts(status);

CREATE INDEX IF NOT EXISTS idx_security_alerts_severity
  ON public.security_alerts(severity);

CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at
  ON public.security_alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_alerts_business_id
  ON public.security_alerts(business_id);

-- RLS: Only authenticated admins can view security alerts
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_alerts_admin_view"
  ON public.security_alerts FOR SELECT
  USING (
    EXISTS(
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('owner', 'platform_admin')
      AND is_active = true
      AND (
        -- platform_admin sees all rows
        role = 'platform_admin'
        OR
        -- owner only sees their own business alerts
        public.security_alerts.business_id = public.current_business_id()
      )
    )
  );

CREATE POLICY "security_alerts_admin_update"
  ON public.security_alerts FOR UPDATE
  USING (
    EXISTS(
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('owner', 'platform_admin')
      AND is_active = true
      AND (
        role = 'platform_admin'
        OR
        public.security_alerts.business_id = public.current_business_id()
      )
    )
  )
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('owner', 'platform_admin')
      AND is_active = true
      AND (
        role = 'platform_admin'
        OR
        public.security_alerts.business_id = public.current_business_id()
      )
    )
  );

-- Function to review and resolve alerts
CREATE OR REPLACE FUNCTION public.fn_resolve_security_alert(
  p_alert_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE public.security_alerts
  SET status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = NOW(),
      resolution_notes = p_notes,
      updated_at = NOW()
  WHERE id = p_alert_id;

  v_result := jsonb_build_object(
    'alert_id', p_alert_id,
    'status', p_status,
    'reviewed_by', auth.uid(),
    'reviewed_at', NOW()
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_resolve_security_alert(UUID, TEXT, TEXT) TO authenticated;
