-- ─────────────────────────────────────────────────────────────────────────────
-- Fix RLS on web_rate_limits
-- Goal: Ensure the table is protected by RLS and forced even for owner bypass.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.web_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_rate_limits FORCE ROW LEVEL SECURITY;
-- Deny all access to ordinary roles (only service_role should bypass or manage this)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'web_rate_limits' AND policyname = 'Deny all web_rate_limits'
    ) THEN
        CREATE POLICY "Deny all web_rate_limits" ON public.web_rate_limits
        FOR ALL
        TO public
        USING (false);
    END IF;
END $$;
