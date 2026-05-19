# Diseño del RPC `fn_finalize_paypal_payment`

> Decisión arquitectónica clave. Candidato a ADR formal.

## Problema

PayPal puede confirmar una captura de **dos vías independientes**:
1. **Frontend** llama a `capturePayPalOrderAction` (server action) tras `onApprove`.
2. **Webhook async** recibe `PAYMENT.CAPTURE.COMPLETED` desde la red de PayPal.

Ambas llegan a finalizar el mismo `paypal_order_id`. Riesgos:
- **Double activation**: dos updates al `businesses.plan` y dos notificaciones al dueño.
- **Double referral bonus**: el referrer recibe +60 días en lugar de +30.
- **Amount mismatch**: el frontend pudo confirmar un monto manipulado.

## Diseño

Una sola RPC atómica en Postgres con `SELECT ... FOR UPDATE` resuelve TODO esto.

### Migración `20260516130000_paypal_finalize_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION fn_finalize_paypal_payment(
  p_order_id        text,
  p_captured_amount numeric,
  p_days            int DEFAULT 30
) RETURNS TABLE (
  result_status   text,
  invoice_id      uuid,
  business_id     uuid,
  plan_purchased  text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice RECORD;
BEGIN
  -- 1. Lock la fila bajo FOR UPDATE — segundo caller espera aquí
  SELECT id, business_id, plan_purchased, amount_usd, status
    INTO v_invoice
    FROM saas_invoices
   WHERE paypal_order_id = p_order_id
   FOR UPDATE;

  -- 2. Invoice no existe → primer caller no creó la fila correctamente
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invoice_not_found'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 3. Ya finalizado → segundo caller llega tarde, idempotente
  IF v_invoice.status = 'finished' THEN
    RETURN QUERY SELECT 'already_processed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased;
    RETURN;
  END IF;

  -- 4. Validar monto (con tolerancia $0.01 para float)
  IF abs(v_invoice.amount_usd - p_captured_amount) > 0.01 THEN
    RETURN QUERY SELECT 'amount_mismatch'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased;
    RETURN;
  END IF;

  -- 5. Marcar invoice como finished
  UPDATE saas_invoices
     SET status     = 'finished',
         updated_at = now()
   WHERE id = v_invoice.id;

  -- 6. Activar plan (aditivo)
  UPDATE businesses
     SET plan                 = v_invoice.plan_purchased,
         subscription_ends_at = CASE
           WHEN subscription_ends_at > now()
             THEN subscription_ends_at + (p_days || ' days')::interval
           ELSE now() + (p_days || ' days')::interval
         END,
         updated_at = now()
   WHERE id = v_invoice.business_id;

  RETURN QUERY SELECT 'completed'::text, v_invoice.id, v_invoice.business_id, v_invoice.plan_purchased;
END;
$$;
```

## Por qué `FOR UPDATE`

- Postgres bloquea la fila hasta el COMMIT de la transacción.
- El segundo caller llega, intenta `FOR UPDATE`, espera, y cuando entra ve `status='finished'` → retorna `already_processed` sin efectos secundarios.
- Atómico a nivel DB — no requiere semáforos en aplicación, ni locks en Redis, ni claim distribuido.

## Por qué `SECURITY DEFINER`

La RPC debe ejecutarse con privilegios del owner (que tiene acceso a `saas_invoices` y `businesses`) aunque el caller use `service_role`. `SET search_path = public` evita ataques de search_path hijacking (migración `20260410000002_fix_function_search_paths.sql` aplica este patrón a TODAS las funciones).

## Por qué se retorna `result_status` en lugar de lanzar

Lanzar excepciones desde PL/pgSQL fuerza al cliente a `try/catch` y oscurece la rama "ya procesado" (que NO es error). Devolver un enum-like en `result_status` permite al caller hacer `switch` limpio:

```ts
switch (row.result_status) {
  case 'completed':         /* fire notifications + applyReferralBonus */
  case 'already_processed': /* 200 OK silencioso */
  case 'amount_mismatch':   /* alert security */
  case 'invoice_not_found': /* warn — race con frontend? */
}
```

## Side effects fuera de la transacción

`applyReferralBonus` y la inserción de la notificación de éxito se hacen **después** del COMMIT, en Node:

```ts
switch (row.result_status) {
  case 'completed':
    await supabaseAdmin.from('notifications').insert({ ... })
    await applyReferralBonus(supabaseAdmin, row.business_id)
    return { status: 'completed', ... }
}
```

Por qué fuera de la RPC:
- `applyReferralBonus` lee `count(*)` de `saas_invoices` (debe ver el COMMIT) y actualiza otra fila de `businesses` (el referrer). Mejor mantenerlo en Node.
- Si la inserción de notification falla, no queremos rollback de la activación.

## Trade-off

Si Node muere entre el COMMIT del RPC y `applyReferralBonus`, el plan queda activo pero el referidor no recibe el bono. Mitigación: el cron diario `check-subscriptions` puede tener una rutina secundaria que escanee referrals huérfanos. Por hoy no se ha observado el caso.

## Tests

- `__tests__/actions/payment-actions.test.ts` — server action capturePayPalOrderAction.
- Migration tests: `supabase/tests/` (PostgresSQL tests directos contra el RPC).
- E2E: `tests/e2e/payment-flow.spec.ts` — simula la doble vía con la API sandbox.
