-- ============================================================================
-- Migration: Atomic batch transaction insert
--
-- Replaces the loop of independent createTransaction() calls in
-- clients/actions.ts registerClientPayment (distribution path).
--
-- Without this, a partial failure left N-1 transactions committed with no
-- rollback. With this RPC, all inserts succeed or all fail together.
--
-- SECURITY INVOKER (default): the caller's JWT is active, so RLS policies
-- on the transactions table still apply. An extra ownership check is added
-- as defense in depth.
--
-- Idempotency: items with an idempotency_key use ON CONFLICT DO NOTHING,
-- matching the existing single-insert behavior in SupabaseFinanceRepository.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_batch_create_transactions(
  p_business_id  UUID,
  p_transactions JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  tx JSONB;
BEGIN
  -- Defense in depth: verify caller owns this business
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: business not owned by caller';
  END IF;

  FOR tx IN SELECT value FROM jsonb_array_elements(p_transactions)
  LOOP
    IF tx->>'idempotency_key' IS NOT NULL THEN
      INSERT INTO public.transactions (
        business_id, appointment_id, amount, net_amount,
        method, notes, idempotency_key
      ) VALUES (
        p_business_id,
        (tx->>'appointment_id')::uuid,
        (tx->>'amount')::numeric,
        (tx->>'net_amount')::numeric,
        (tx->>'method')::payment_method,
        tx->>'notes',
        tx->>'idempotency_key'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    ELSE
      INSERT INTO public.transactions (
        business_id, appointment_id, amount, net_amount, method, notes
      ) VALUES (
        p_business_id,
        (tx->>'appointment_id')::uuid,
        (tx->>'amount')::numeric,
        (tx->>'net_amount')::numeric,
        (tx->>'method')::payment_method,
        tx->>'notes'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;
