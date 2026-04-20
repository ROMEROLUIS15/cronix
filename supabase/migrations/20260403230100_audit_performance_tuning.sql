-- 20260403230100_audit_performance_tuning.sql
BEGIN;
-- 1. DROP Redundant Policies
DROP POLICY IF EXISTS "passkey_challenges_select_own" ON public.passkey_challenges;
DROP POLICY IF EXISTS "passkey_challenges_insert_own" ON public.passkey_challenges;
DROP POLICY IF EXISTS "passkey_challenges_delete_own" ON public.passkey_challenges;
DROP POLICY IF EXISTS "users_self_select" ON public.users;
-- 2. CREATE explicit DENY DEFAULT for webhook tables without policies
DROP POLICY IF EXISTS "Deny all wa_rate_limits" ON public.wa_rate_limits;
CREATE POLICY "Deny all wa_rate_limits" ON public.wa_rate_limits FOR ALL USING (false);
DROP POLICY IF EXISTS "Deny all wa_business_usage" ON public.wa_business_usage;
CREATE POLICY "Deny all wa_business_usage" ON public.wa_business_usage FOR ALL USING (false);
DROP POLICY IF EXISTS "Deny all wa_token_usage" ON public.wa_token_usage;
CREATE POLICY "Deny all wa_token_usage" ON public.wa_token_usage FOR ALL USING (false);
DROP POLICY IF EXISTS "Deny all wa_booking_limits" ON public.wa_booking_limits;
CREATE POLICY "Deny all wa_booking_limits" ON public.wa_booking_limits FOR ALL USING (false);
DROP POLICY IF EXISTS "Deny all web_rate_limits" ON public.web_rate_limits;
CREATE POLICY "Deny all web_rate_limits" ON public.web_rate_limits FOR ALL USING (false);
DROP POLICY IF EXISTS "Deny all service_health" ON public.service_health;
CREATE POLICY "Deny all service_health" ON public.service_health FOR ALL USING (false);
-- 3. OPTIMIZE RLS (Replace auth.uid() with (select auth.uid()))

-- notification_subscriptions
DROP POLICY IF EXISTS "notif_subs_select_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_select_own" ON public.notification_subscriptions FOR SELECT USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "notif_subs_insert_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_insert_own" ON public.notification_subscriptions FOR INSERT WITH CHECK (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "notif_subs_update_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_update_own" ON public.notification_subscriptions FOR UPDATE USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "notif_subs_delete_own" ON public.notification_subscriptions;
CREATE POLICY "notif_subs_delete_own" ON public.notification_subscriptions FOR DELETE USING (user_id = (select auth.uid()));
-- appointment_services
DROP POLICY IF EXISTS "appointment_services_all" ON public.appointment_services;
CREATE POLICY "appointment_services_all" ON public.appointment_services FOR ALL USING (
  appointment_id IN ( SELECT a.id FROM appointments a WHERE a.business_id IN ( SELECT u.business_id FROM users u WHERE u.id = (select auth.uid()) ))
);
-- user_passkeys
DROP POLICY IF EXISTS "Users manage own passkeys" ON public.user_passkeys;
CREATE POLICY "Users manage own passkeys" ON public.user_passkeys FOR ALL USING (user_id = (select auth.uid()));
-- passkey_challenges (We keep challenges_own_user)
DROP POLICY IF EXISTS "challenges_own_user" ON public.passkey_challenges;
CREATE POLICY "challenges_own_user" ON public.passkey_challenges FOR ALL USING (user_id = (select auth.uid()));
-- users
DROP POLICY IF EXISTS "users_insert" ON public.users;
CREATE POLICY "users_insert" ON public.users AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (id = (select auth.uid()));
DROP POLICY IF EXISTS "users_update" ON public.users;
CREATE POLICY "users_update" ON public.users AS PERMISSIVE FOR UPDATE TO authenticated USING (id = (select auth.uid()));
DROP POLICY IF EXISTS "users_select_same_business" ON public.users;
CREATE POLICY "users_select_same_business" ON public.users FOR SELECT USING (id = (select auth.uid()) OR business_id = get_my_business_id());
-- appointment_reminders
DROP POLICY IF EXISTS "reminders_select_own_business" ON public.appointment_reminders;
CREATE POLICY "reminders_select_own_business" ON public.appointment_reminders FOR SELECT USING (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
DROP POLICY IF EXISTS "reminders_insert_own_business" ON public.appointment_reminders;
CREATE POLICY "reminders_insert_own_business" ON public.appointment_reminders FOR INSERT WITH CHECK (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
DROP POLICY IF EXISTS "reminders_update_own_business" ON public.appointment_reminders;
CREATE POLICY "reminders_update_own_business" ON public.appointment_reminders FOR UPDATE USING (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
DROP POLICY IF EXISTS "reminders_delete_own_business" ON public.appointment_reminders;
CREATE POLICY "reminders_delete_own_business" ON public.appointment_reminders FOR DELETE USING (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
-- businesses
DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;
CREATE POLICY "businesses_insert" ON public.businesses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (owner_id = (select auth.uid()));
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
CREATE POLICY "businesses_select" ON public.businesses AS PERMISSIVE FOR SELECT TO authenticated USING (owner_id = (select auth.uid()) OR id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
DROP POLICY IF EXISTS "businesses_update" ON public.businesses;
CREATE POLICY "businesses_update" ON public.businesses AS PERMISSIVE FOR UPDATE TO authenticated USING (owner_id = (select auth.uid()));
-- expenses
DROP POLICY IF EXISTS "expenses_all" ON public.expenses;
CREATE POLICY "expenses_all" ON public.expenses AS PERMISSIVE FOR ALL TO authenticated USING (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
-- wa_audit_logs
DROP POLICY IF EXISTS "wa_audit_logs_isolation" ON public.wa_audit_logs;
CREATE POLICY "wa_audit_logs_isolation" ON public.wa_audit_logs AS PERMISSIVE FOR ALL TO authenticated USING (business_id IN (SELECT business_id FROM users WHERE id = (select auth.uid())));
-- 4. HARDEN FUNCTIONS (Mutable Search Path)
ALTER FUNCTION public.fn_book_appointment_wa(p_business_id uuid, p_client_phone text, p_client_name text, p_service_id uuid, p_start_at timestamp with time zone) SET search_path = '';
ALTER FUNCTION public.fn_find_client_by_phone(p_business_id uuid, p_phone_digits text) SET search_path = '';
ALTER FUNCTION public.fn_reset_all_web_rate_limits() SET search_path = '';
ALTER FUNCTION public.get_inactive_clients_rpc(biz_id uuid, sixty_days_ago timestamp with time zone) SET search_path = '';
ALTER FUNCTION public.get_my_business_id() SET search_path = '';
-- 5. INDEXES
-- Unused/Duplicate Drop
DROP INDEX IF EXISTS idx_reminders_business;
DROP INDEX IF EXISTS idx_passkeys_user;
DROP INDEX IF EXISTS idx_wa_dlq_service_type;
DROP INDEX IF EXISTS idx_appointments_business_start;
DROP INDEX IF EXISTS idx_clients_active_biz;
-- Create Covering Index for FKs
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_user_id ON public.passkey_challenges(user_id);
COMMIT;
