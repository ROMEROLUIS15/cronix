# Sistema de pagos — Cronix

> Fusión de `PAYMENTS_AND_PLANS.md` + `PAYPAL_INTEGRATION_GUIDE.md`.
> Verificado contra `lib/payments/`, `app/api/webhooks/`, `app/api/queue/process-saas-payment/`, `app/[locale]/dashboard/admin/payments/` y migraciones `20260430120000_saas_invoices.sql`, `20260502000000_manual_payments.sql`, `20260516120000_paypal_support.sql`, `20260516130000_paypal_finalize_rpc.sql`.

## 1. Tres pasarelas convergen en `saas_invoices`

| Pasarela | Trigger | Webhook | Idempotencia | Estados manejados |
|---|---|---|---|---|
| **PayPal** | Botón `@paypal/react-paypal-js` | `/api/webhooks/paypal` (verifyWebhookSignature) | RPC `fn_finalize_paypal_payment` (`FOR UPDATE`) | `PAYMENT.CAPTURE.COMPLETED` |
| **NOWPayments (cripto)** | Server Action `createSaaSCheckoutSession` | `/api/webhooks/nowpayments` → QStash → `/api/queue/process-saas-payment` | `toInvoiceStatus(payment_status)` + `np_invoice_id` único | `waiting/confirming/confirmed/sending/partially_paid/finished/failed/refunded/expired` |
| **Manual (Pago Móvil VE + Binance Pay)** | Form en `/dashboard/settings/payment-method-modal` | n/a — verificación admin | Aprobación humana en `/dashboard/admin/payments` | n/a |

Tabla `saas_invoices` (migración `20260430120000`):
```sql
id uuid pk, business_id uuid, plan_purchased text, amount_usd numeric,
status saas_invoice_status, payment_provider text,
np_invoice_id text unique, np_payment_id text,
paypal_order_id text unique, crypto_amount numeric, crypto_currency text,
created_at, updated_at
```

## 2. PayPal — flujo dual (frontend + webhook)

```
Usuario clic en PayPal
   │
   ▼
createOrder server action ─► saas_invoices.insert(status='waiting', paypal_order_id)
   │
   ▼
PayPal popup ──── usuario aprueba y captura
   │
   ├── (A) Frontend onApprove ──► capturePayPalOrderAction (server action)
   │                                  └─► finalizePayPalPayment(orderId, amount)
   │
   └── (B) PayPal webhook PAYMENT.CAPTURE.COMPLETED
          └─► /api/webhooks/paypal
                  ├─ verifyWebhookSignature (PayPal API /v1/notifications/verify-webhook-signature)
                  └─► finalizePayPalPayment(orderId, amount)
                                  │
                                  ▼
              RPC fn_finalize_paypal_payment (atómico):
                  BEGIN
                    SELECT … FOR UPDATE WHERE paypal_order_id = $1 AND status != 'finished'
                    IF NOT FOUND → already_processed
                    IF amount_usd != captured → amount_mismatch
                    UPDATE saas_invoices SET status='finished'
                    UPDATE businesses
                       SET plan = plan_purchased,
                           subscription_ends_at = computeNextSubscriptionEnd(...)
                  COMMIT
                  RETURN { result_status, invoice_id, business_id, plan_purchased }
```

**Por qué dos vías**: si el usuario cierra la pestaña a mitad del flujo, PayPal cobró pero el frontend no confirma. El webhook actúa como red de seguridad.

**Por qué `FOR UPDATE`**: cuando frontend y webhook llegan a la vez, el primero gana el lock y el segundo ve `status='finished'` → retorna `already_processed`. Idempotencia atómica garantizada por Postgres, no por código de aplicación.

**Por qué `PAYPAL_ENV=live` es opt-in explícito**: Vercel inyecta `NODE_ENV=production` en TODOS los deploys (incluyendo previews de PRs). Usar `NODE_ENV` como señal cobraría dinero real en cada preview. Por eso `lib/payments/paypal.ts:9` solo activa Live cuando `PAYPAL_ENV === 'live'`.

## 3. NOWPayments (cripto, USDT BSC)

```
Usuario clic Cripto → createSaaSCheckoutSession (server action)
   └─► POST nowpayments.io/v1/invoice (genera np_invoice_id)
       └─► saas_invoices.insert(status='waiting', np_invoice_id)
       └─► return invoice_url

Usuario paga en NOWPayments hosted page
   │
   ▼
NOWPayments IPN webhook (firmado HMAC con IPN_SECRET)
   │
   ▼
/api/webhooks/nowpayments
   ├─ verify HMAC (lib/payments/nowpayments.ts)
   ├─ Publish to QStash queue (Retry-After back-pressure)
   └─ 200 OK inmediato (evita timeout Vercel)

QStash dequeue
   │
   ▼
/api/queue/process-saas-payment (verifySignatureAppRouter)
   ├─ toInvoiceStatus(payment_status)
   ├─ Update saas_invoices
   ├─ Si status='finished' → update businesses.plan + subscription_ends_at (aditivo)
   ├─ Insert notification 'success'
   └─ applyReferralBonus(business_id)
```

`toInvoiceStatus` mapea estados de NOWPayments a nuestro enum unificado:
- `waiting → waiting`
- `confirming/confirmed/sending → confirming`
- `partially_paid → partially_paid` (notificación warning)
- `finished → finished`
- `failed/refunded/expired → mismo nombre`

## 4. Pago manual (Pago Móvil VE + Binance Pay)

Usuario envía comprobante por el form → registra fila en tabla de pagos manuales → admin platform_admin aprueba/rechaza en `/dashboard/admin/payments`. Tasa BCV (Banco Central de Venezuela) se obtiene de `lib/payments/bcv-rate.ts` y se aplica un markup del 30% para cubrir spread y volatilidad.

## 5. Helper compartido — `subscription-fulfillment.ts`

### `computeNextSubscriptionEnd(currentEndsAt, daysToAdd=30)`

Lógica **aditiva**:
- Si `currentEndsAt > now` → suma días al final actual (recompensa renovar temprano).
- Si `currentEndsAt ≤ now` → parte desde hoy.

Usado por ambos webhooks (PayPal y cripto).

### `applyReferralBonus(supabaseAdmin, businessId)`

Solo dispara cuando es el **primer** `saas_invoice` `finished` del negocio referido:
```sql
SELECT count(*) FROM saas_invoices
 WHERE business_id = X AND status = 'finished' = 1
```

Si pasa, busca `businesses.referred_by_id`, valida que el referrer tenga plan ≠ free, y suma `REFERRAL_BONUS_DAYS` (30) a su `subscription_ends_at`. Inserta una notification `success` con copy "¡Mes gratis ganado! 🎁".

## 6. Cron de vencimientos — `/api/cron/check-subscriptions`

Corre diariamente. Para cada `businesses.subscription_ends_at < now` con `plan ≠ free`:
1. Downgrade a `free`.
2. Notificación al dueño con CTA de renovación.

## 7. Tests

- `__tests__/components/referral-client.test.tsx`
- `__tests__/actions/payment-actions.test.ts` (server actions PayPal)
- `lib/payments/nowpayments.test.ts`
- Integration: `tests/e2e/plans-referrals.spec.ts`, `tests/e2e/payment-flow.spec.ts`

## 8. Seguridad

- **PayPal webhook**: firma verificada llamando a la API oficial de PayPal `/v1/notifications/verify-webhook-signature` con `PAYPAL_WEBHOOK_ID`. Sin verificación → 401.
- **NOWPayments webhook**: HMAC del body con `NOWPAYMENTS_IPN_SECRET`.
- **QStash → queue worker**: `verifySignatureAppRouter` usa `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` (rotación).
- **Admin payments approval**: chequeo `role === 'platform_admin'` en server-side antes de mutar.

## 9. Migraciones relevantes

| Migración | Objeto |
|---|---|
| `20260430120000_saas_invoices.sql` | Tabla `saas_invoices` + enum `saas_invoice_status` |
| `20260430130000_reset_plans_to_free.sql` | Backfill defensivo |
| `20260502000000_manual_payments.sql` | Tabla `manual_payments` + RLS |
| `20260504100000_referral_system.sql` | `businesses.referred_by_id`, `referral_code`, `applyReferralBonus` triggers |
| `20260516120000_paypal_support.sql` | Columnas `paypal_order_id`, `payment_provider` |
| `20260516130000_paypal_finalize_rpc.sql` | RPC atómico `fn_finalize_paypal_payment` |
