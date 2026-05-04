-- Create SaaS invoice status enum (idempotent)
DO $$ BEGIN
  CREATE TYPE saas_invoice_status AS ENUM ('waiting', 'confirming', 'finished', 'partially_paid', 'failed', 'expired', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create saas_invoices table (idempotent)
CREATE TABLE IF NOT EXISTS public.saas_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  np_invoice_id TEXT UNIQUE,
  np_payment_id TEXT,
  amount_usd DECIMAL(10,2) NOT NULL,
  crypto_amount DECIMAL(16,8),
  crypto_currency TEXT,
  status saas_invoice_status NOT NULL DEFAULT 'waiting',
  plan_purchased business_plan NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add subscription control to businesses (idempotent)
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

-- RLS Policies (idempotent)
ALTER TABLE public.saas_invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own saas invoices"
    ON public.saas_invoices FOR SELECT
    USING (
      business_id IN (
        SELECT business_id FROM public.users WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only service role can insert/update (webhooks and server actions)
-- So no INSERT/UPDATE policies for authenticated users.

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_saas_invoices_np_invoice_id ON public.saas_invoices(np_invoice_id);
CREATE INDEX IF NOT EXISTS idx_saas_invoices_np_payment_id ON public.saas_invoices(np_payment_id);
CREATE INDEX IF NOT EXISTS idx_saas_invoices_business_id ON public.saas_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_businesses_subscription_ends_at ON public.businesses(subscription_ends_at);

-- Add trigger for updated_at (idempotent)
DO $$ BEGIN
  CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.saas_invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
