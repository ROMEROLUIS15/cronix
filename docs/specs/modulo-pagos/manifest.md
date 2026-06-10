# 📋 Manifiesto de Dominio: Módulo de Pagos

Este documento define el contrato del módulo de pagos de suscripción SaaS de Cronix. Es un módulo distinto al `RegisterPaymentUseCase` de citas (que registra cobros manuales al cliente final). Este módulo gestiona la suscripción del dueño del negocio a la plataforma.

## 1. Principio de Abstracción (Patrón Adapter)

Queda **prohibido** que cualquier componente de UI, server action o Use Case llame directamente a la API de PayPal, NowPayments u otro proveedor. Todo acceso a proveedores de pago externos se hace a través de los módulos wrapper en `lib/payments/`:

```
UI / Server Action
       │
       ▼
lib/payments/{proveedor}.ts  ← Adapter/Wrapper
       │
       ▼
API externa (PayPal, NowPayments, etc.)
```

Si mañana se cambia el proveedor, solo se modifica el wrapper. El caller no cambia.

## 2. Proveedores Implementados

### PayPal (`lib/payments/paypal.ts`)
- Proveedor principal para mercados con tarjeta de crédito internacional
- Flujo: Crear orden → Capturar pago → Webhook de confirmación
- Finalización idempotente via RPC: `fn_finalize_paypal_payment(orderId, capturedAmount, days)`
- El RPC usa `FOR UPDATE` lock para prevenir race conditions en doble captura

### NowPayments (`lib/payments/nowpayments.ts`)
- Proveedor para pagos en criptomonedas
- Flujo: Crear invoice → Webhook → QStash → `app/api/queue/process-saas-payment/route.ts`
- Finalización idempotente y atómica via RPC: `fn_finalize_crypto_payment(np_invoice_id, np_payment_id, status, crypto_amount, crypto_currency, days)`
- A diferencia de PayPal, el webhook cripto dispara en cada transición de estado
  (waiting → confirming → finished/partially_paid). El RPC **siempre** persiste la factura
  y solo activa plan + bono cuando el estado entrante es `finished`. Devuelve `result_status`
  ∈ {`completed`, `updated`, `already_processed`, `invoice_not_found`}. No valida monto:
  NowPayments lo enforce on-chain (estado `finished` = pago completo).

### Tasa BCV (`lib/payments/bcv-rate.ts`)
- Wrapper para consultar la tasa oficial BCV (Banco Central de Venezuela)
- Tiene caché integrado con TTL para no saturar la fuente
- Se usa para convertir precios de USD a VES en mercados venezolanos

## 3. Flujo de Fulfillment (`subscription-fulfillment.ts`)

El fulfillment es el proceso post-pago: activar el plan del negocio.

```
fn_finalize_paypal_payment (RPC atómica)
    │ EN UNA SOLA TRANSACCIÓN: actualiza factura + negocio + aplica bono de referido
    │ (llama internamente a fn_apply_referral_bonus) y devuelve referral_bonus_applied
    ▼
finalizePayPalPayment()
    │
    ├─ status: 'already_processed' → return (idempotencia)
    ├─ status: 'invoice_not_found' → return error
    ├─ status: 'amount_mismatch'   → return error (fraude/manipulación)
    └─ status: 'completed'
          │  (plan, fecha y bono YA quedaron persistidos atómicamente en el RPC)
          ├─ INSERT en notifications (confirmación de pago al dueño)
          ├─ void fetch('push-notify') (Web Push al PWA)
          └─ void push al referidor si referral_bonus_applied === true
```

**Regla de idempotencia:** El RPC `fn_finalize_paypal_payment` usa `FOR UPDATE` + chequeo de `status = 'finished'` como optimistic lock. Si el webhook llega dos veces para el mismo `orderId`, la segunda ejecución retorna `already_processed` sin efectos secundarios.

**Por qué el bono va dentro de la TX (saneamiento, migración `20260610120000_referral_bonus_atomic.sql`):** antes el bono se aplicaba en Node DESPUÉS del COMMIT; si Node moría en esa ventana, el reintento veía la factura ya `finished` y saltaba el bono → pérdida irreversible para el referidor. Ahora el conteo de facturas `finished` ocurre en la misma TX (la recién marcada es visible → da exactamente 1 en el primer pago), garantizando atomicidad e idempotencia.

## 4. Flujo de Bonus por Referido (`fn_apply_referral_bonus`)

**Fuente única de verdad = la función SQL `fn_apply_referral_bonus(p_referred_business_id, p_days)`.** El wrapper TS `applyReferralBonus()` solo la invoca vía rpc y dispara el push best-effort.

- Se ejecuta solo si el negocio tiene `referred_by_id`
- Se activa solo en la **primera** factura `finished` del negocio referido (conteo en SQL)
- Extiende la suscripción del referidor en `p_days` días. **Fuente única de verdad = la constante TS `REFERRAL_BONUS_DAYS` en `lib/plans/plan-limits.ts`.** Node la inyecta como `p_days` en ambos RPC de finalización (`fn_finalize_paypal_payment` en `subscription-fulfillment.ts`, `fn_finalize_crypto_payment` en `process-saas-payment/route.ts`); el RPC la propaga a `fn_apply_referral_bonus`. El `DEFAULT 30` de la firma SQL es solo fallback para llamadas directas — el runtime nunca lo usa. El texto de la notificación y el push también derivan de ese valor (no se hardcodea el número). El test `subscription-fulfillment.test.ts` actúa de guardián: el assert compara contra `REFERRAL_BONUS_DAYS`, no contra un literal.
- Si el referidor está en plan `free`, no aplica bonus
- Genera notificación al referidor: "¡Mes gratis ganado! 🎁"
- **Ambas vías** (PayPal y cripto) la aplican dentro de su respectivo RPC de finalización (`fn_finalize_paypal_payment` / `fn_finalize_crypto_payment`), en la misma transacción. Node solo dispara el push best-effort al referidor cuando el RPC devuelve `referral_bonus_applied = true`.

## 5. Reglas de Seguridad

- **Nunca confiar en el monto reportado por el cliente:** El monto capturado se compara contra el precio del plan en DB — si hay discrepancia → `amount_mismatch`
- **Webhooks con firma:** Todos los webhooks de proveedores externos deben validar la firma del proveedor antes de procesar
- **Admin client obligatorio:** El fulfillment solo puede ejecutarse con un `SupabaseClient` con `service_role` — nunca con el cliente anónimo del frontend

## 6. Criterios de Aceptación

**AC-1 — Idempotencia de pago:**
- DADO un `orderId` ya procesado con `status: 'finished'`,
- CUANDO llega un segundo webhook con el mismo `orderId`,
- ENTONCES `finalizePayPalPayment` retorna `{ status: 'already_processed' }` sin modificar DB.

**AC-2 — Protección contra monto manipulado:**
- DADO un `orderId` legítimo con precio esperado de $19.99,
- CUANDO el webhook reporta `capturedAmount: 0.01`,
- ENTONCES retorna `{ status: 'amount_mismatch' }` y el plan NO se activa.

**AC-3 — Bonus de referido se aplica una sola vez:**
- DADO un negocio referido que ya pagó su primera factura,
- CUANDO paga una segunda factura,
- ENTONCES `fn_apply_referral_bonus` cuenta las facturas `finished` (`count <> 1`) y no aplica bonus adicional.

**AC-4 — Atomicidad del bono (PayPal y cripto):**
- DADO un pago de un negocio referido elegible (vía PayPal o NowPayments),
- CUANDO `fn_finalize_paypal_payment` / `fn_finalize_crypto_payment` confirma el pago (`finished`),
- ENTONCES el bono al referidor se persiste en la MISMA transacción; ningún fallo de Node posterior al COMMIT puede perderlo, y un reintento (`already_processed`) no lo duplica.
