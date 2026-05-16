-- Migration: Add paypal support to saas_invoices
-- Modifies: payment_method constraint to allow 'paypal'

DO $$ 
DECLARE
  constraint_name text;
BEGIN
  -- Find the dynamically generated check constraint for payment_method
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute attr ON attr.attrelid = con.conrelid AND attr.attnum = ANY(con.conkey)
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'saas_invoices'
    AND attr.attname = 'payment_method'
    AND con.contype = 'c';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.saas_invoices DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;

  -- Add the new constraint including 'paypal'
  ALTER TABLE public.saas_invoices 
    ADD CONSTRAINT saas_invoices_payment_method_check 
    CHECK (payment_method IN ('nowpayments', 'pago_movil', 'binance_manual', 'paypal'));
END $$;

COMMENT ON COLUMN public.saas_invoices.payment_method IS
  'Payment gateway: nowpayments (crypto) | pago_movil | binance_manual | paypal';
