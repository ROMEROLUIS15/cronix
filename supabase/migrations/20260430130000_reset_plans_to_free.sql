-- Reset all businesses to free plan that don't have a finished paid invoice.
-- These were auto-assigned 'pro' during registration before the fix.
UPDATE public.businesses
SET
  plan               = 'free',
  subscription_ends_at = NULL,
  updated_at         = NOW()
WHERE plan != 'free'
  AND id NOT IN (
    SELECT business_id
    FROM   public.saas_invoices
    WHERE  status = 'finished'
  );
