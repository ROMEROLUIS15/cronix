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
- Flujo: Crear invoice → Webhook de confirmación de pago on-chain
- También finaliza via `fn_finalize_paypal_payment` (mismo RPC, mismo contrato)

### Tasa BCV (`lib/payments/bcv-rate.ts`)
- Wrapper para consultar la tasa oficial BCV (Banco Central de Venezuela)
- Tiene caché integrado con TTL para no saturar la fuente
- Se usa para convertir precios de USD a VES en mercados venezolanos

## 3. Flujo de Fulfillment (`subscription-fulfillment.ts`)

El fulfillment es el proceso post-pago: activar el plan del negocio.

```
fn_finalize_paypal_payment (RPC atómica)
    │ actualiza factura + negocio en una transacción
    ▼
finalizePayPalPayment()
    │
    ├─ status: 'already_processed' → return (idempotencia)
    ├─ status: 'invoice_not_found' → return error
    ├─ status: 'amount_mismatch'   → return error (fraude/manipulación)
    └─ status: 'completed'
          │
          ├─ INSERT en notifications (confirmación de pago al dueño)
          ├─ void fetch('push-notify') (Web Push al PWA)
          └─ applyReferralBonus() (si el negocio fue referido)
```

**Regla de idempotencia:** El RPC `fn_finalize_paypal_payment` usa `UPDATE ... WHERE status != 'finished'` como optimistic lock. Si el webhook llega dos veces para el mismo `orderId`, la segunda ejecución retorna `already_processed` sin efectos secundarios.

## 4. Flujo de Bonus por Referido (`applyReferralBonus`)

- Se ejecuta solo si el negocio tiene `referred_by_id`
- Se activa solo en la **primera** factura pagada del negocio referido
- Extiende la suscripción del referidor en `REFERRAL_BONUS_DAYS` días
- Si el referidor está en plan `free`, no aplica bonus
- Genera notificación al referidor: "¡Mes gratis ganado! 🎁"

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
- ENTONCES `applyReferralBonus` verifica que `count !== 1` y no aplica bonus adicional.
