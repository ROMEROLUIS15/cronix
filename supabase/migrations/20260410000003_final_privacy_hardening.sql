-- 20260410000003_final_privacy_hardening.sql
-- Goal: Ensure platform logs are NOT visible to business owners/employees (Privacy Layer)

BEGIN;
-- 1. wa_audit_logs Hardening
ALTER TABLE public.wa_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_audit_logs_isolation" ON public.wa_audit_logs;
DROP POLICY IF EXISTS "Users can view audit logs for their business" ON public.wa_audit_logs;
DROP POLICY IF EXISTS "Enable read for service_role" ON public.wa_audit_logs;
DROP POLICY IF EXISTS "Deny read for authenticated" ON public.wa_audit_logs;
CREATE POLICY "service_role_all" ON public.wa_audit_logs FOR ALL TO service_role USING (true);
-- Implicitly denied for all other roles

-- 2. wa_dead_letter_queue Hardening
ALTER TABLE public.wa_dead_letter_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read for service_role" ON public.wa_dead_letter_queue;
DROP POLICY IF EXISTS "Deny read for authenticated" ON public.wa_dead_letter_queue;
CREATE POLICY "service_role_all" ON public.wa_dead_letter_queue FOR ALL TO service_role USING (true);
-- 3. service_health Hardening (Ensure consistency)
ALTER TABLE public.service_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all service_health" ON public.service_health;
CREATE POLICY "service_role_all" ON public.service_health FOR ALL TO service_role USING (true);
-- 4. Passkey Challenges (Fixing the skips seen in migration log)
ALTER TABLE public.passkey_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "challenges_own_user" ON public.passkey_challenges;
CREATE POLICY "challenges_own_user" ON public.passkey_challenges 
FOR ALL TO authenticated 
USING (user_id = (select auth.uid()));
COMMIT;
