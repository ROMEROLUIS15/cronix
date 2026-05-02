-- Migration: Add manual payment support to saas_invoices
-- Adds: payment_method, reference_number, admin_notes
-- Makes np_invoice_id nullable (NOWPayments invoices not needed for manual payments)

-- 1. Make np_invoice_id nullable for manual payment records
ALTER TABLE public.saas_invoices
  ALTER COLUMN np_invoice_id DROP NOT NULL;

-- 2. Add payment_method column
ALTER TABLE public.saas_invoices
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'nowpayments'
    CHECK (payment_method IN ('nowpayments', 'pago_movil', 'binance_manual'));

-- 3. Add reference_number for manual payments (last digits of transfer, Binance TX ID, etc.)
ALTER TABLE public.saas_invoices
  ADD COLUMN IF NOT EXISTS reference_number text NULL;

-- 4. Add admin_notes for approval/rejection reason
ALTER TABLE public.saas_invoices
  ADD COLUMN IF NOT EXISTS admin_notes text NULL;

-- 5. Index for admin panel query (pending manual payments)
CREATE INDEX IF NOT EXISTS idx_saas_invoices_manual_pending
  ON public.saas_invoices (payment_method, status, created_at DESC)
  WHERE payment_method IN ('pago_movil', 'binance_manual');

-- 6. Update 'waiting' status to work as 'pending_review' signal for manual payments
-- (we reuse the existing 'confirming' status to mean "under manual review")

COMMENT ON COLUMN public.saas_invoices.payment_method IS
  'Payment gateway: nowpayments (automatic) | pago_movil | binance_manual (manual, requires admin approval)';
COMMENT ON COLUMN public.saas_invoices.reference_number IS
  'Last digits of bank transfer reference or Binance TX ID for manual verification';
COMMENT ON COLUMN public.saas_invoices.admin_notes IS
  'Admin approval/rejection notes visible to the operator';
