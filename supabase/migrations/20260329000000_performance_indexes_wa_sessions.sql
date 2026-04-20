-- 20260329000000_performance_indexes_wa_sessions.sql
-- Performance audit: missing table + missing indexes for WhatsApp subsystem

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. wa_sessions — conversation memory table (was created manually in production
--    but never had a versioned migration)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.wa_sessions (
    sender_phone text PRIMARY KEY,
    business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    updated_at   timestamptz DEFAULT now()
);
COMMENT ON TABLE public.wa_sessions IS
  'Single-number SaaS: maps a WhatsApp sender to their last-active business.';
-- FK index — used by cascade deletes and JOIN in getSessionBusiness()
CREATE INDEX IF NOT EXISTS idx_wa_sessions_business
  ON public.wa_sessions (business_id);
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. wa_audit_logs — missing indexes for fetchConversationHistory()
--    Query: WHERE business_id = ? AND sender_phone = ? ORDER BY created_at DESC LIMIT 8
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_wa_audit_logs_conversation
  ON public.wa_audit_logs (business_id, sender_phone, created_at DESC);
-- RLS policy for wa_audit_logs (was missing — only service_role was accessing it,
-- but adding RLS is defense-in-depth)
ALTER TABLE public.wa_audit_logs ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS automatically. This policy allows dashboard reads
-- if we ever expose audit logs in the UI.
DROP POLICY IF EXISTS "Users can view audit logs for their business" ON public.wa_audit_logs;
CREATE POLICY "Users can view audit logs for their business"
  ON public.wa_audit_logs FOR SELECT
  USING (business_id = public.get_my_business_id());
-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. wa_sessions RLS (defense-in-depth, same pattern)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view sessions for their business" ON public.wa_sessions;
CREATE POLICY "Users can view sessions for their business"
  ON public.wa_sessions FOR SELECT
  USING (business_id = public.get_my_business_id());
