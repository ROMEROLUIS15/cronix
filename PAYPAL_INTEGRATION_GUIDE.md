# PayPal Integration Guide — Cronix

> Pasarela de pagos PayPal con captura idempotente, webhook como red de seguridad y fulfillment atómico en Postgres. Documento técnico orientado a operación profesional.

---

## Tabla de contenidos

1. [Arquitectura y ciclo de vida de la orden](#1-arquitectura-y-ciclo-de-vida-de-la-orden)
2. [Por qué webhook async + frontend dual-path](#2-por-qué-webhook-async--frontend-dual-path)
3. [Configuración en PayPal Developer](#3-configuración-en-paypal-developer)
4. [Variables de entorno y matriz de scopes](#4-variables-de-entorno-y-matriz-de-scopes)
5. [Configuración en Vercel](#5-configuración-en-vercel)
6. [Suite de pruebas operacionales](#6-suite-de-pruebas-operacionales)
7. [Logs de validación y observabilidad](#7-logs-de-validación-y-observabilidad)
8. [Garantías de seguridad](#8-garantías-de-seguridad)
9. [Runbook de incidentes](#9-runbook-de-incidentes)

---

## 1. Arquitectura y ciclo de vida de la orden

### Componentes

| Pieza | Ruta | Responsabilidad |
|---|---|---|
| UI | `app/[locale]/dashboard/settings/payment-method-modal.tsx` | Renderiza `PayPalButtons` (PayPal blue + Card black) y delega a server actions |
| Server actions | `app/[locale]/dashboard/settings/actions.ts` | `createPayPalOrderAction` / `capturePayPalOrderAction` con auth + ownership |
| SDK adapter | `lib/payments/paypal.ts` | Wrappers `createOrder`, `captureOrder`, `verifyWebhookSignature` |
| Fulfillment | `lib/payments/subscription-fulfillment.ts` | `finalizePayPalPayment` + `applyReferralBonus` + `computeNextSubscriptionEnd` |
| Webhook | `app/api/webhooks/paypal/route.ts` | Endpoint async para `PAYMENT.CAPTURE.COMPLETED` |
| RPC atómica | `supabase/migrations/20260516130000_paypal_finalize_rpc.sql` | `fn_finalize_paypal_payment` con `FOR UPDATE` lock |

### Ciclo de vida (camino feliz)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Usuario abre el modal de plan → elige PayPal                      │
└──────────────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2. createPayPalOrderAction(plan)                                     │
│    • supabase.auth.getUser()                                         │
│    • Lookup business por owner_id                                    │
│    • PayPal API → POST /v2/checkout/orders                           │
│    • INSERT saas_invoices (status='waiting', np_invoice_id=orderId)  │
│    Returns: { orderId }                                              │
└──────────────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3. PayPal popup: usuario autoriza el pago                            │
└──────────────────┬───────────────────────────────────────────────────┘
                   │           ╔════════════════════════════════════════╗
                   │           ║  Aquí divergen dos caminos             ║
                   │           ║  paralelos que terminan en el          ║
                   │           ║  mismo fulfillment idempotente         ║
                   │           ╚════════════════════════════════════════╝
       ┌───────────┴────────────┐
       │                        │
       ▼                        ▼
┌─────────────────┐    ┌────────────────────────────────────────────────┐
│ 4a. Frontend    │    │ 4b. PayPal → POST /api/webhooks/paypal         │
│ onApprove fires │    │     PAYMENT.CAPTURE.COMPLETED (5–30s después)  │
│ ↓               │    │     ↓                                          │
│ capturePayPal   │    │     verifyWebhookSignature() vía PayPal API    │
│ OrderAction     │    │     ↓                                          │
│ ↓               │    │     finalizePayPalPayment()                    │
│ Auth +          │    │                                                │
│ ownership +     │    │                                                │
│ paypal.capture  │    │                                                │
│ ↓               │    │                                                │
│ finalizePayPal  │    │                                                │
│ Payment()       │    │                                                │
└────────┬────────┘    └─────────────────────┬──────────────────────────┘
         │                                   │
         └──────────────┬────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 5. RPC fn_finalize_paypal_payment (PG transaction, FOR UPDATE lock)  │
│    • Lock saas_invoices row by np_invoice_id                         │
│    • Si status='finished' → return 'already_processed' (idempotente) │
│    • Validar monto capturado vs amount_usd (±0.01 tolerancia)        │
│    • UPDATE saas_invoices SET status='finished'                      │
│    • UPDATE businesses SET plan, subscription_ends_at (aditivo)      │
│    Commit atómico — todo o nada.                                     │
└──────────────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 6. Best-effort (fuera de la transacción):                            │
│    • INSERT notifications ('¡Pago Confirmado! 🎉', type='success')   │
│    • applyReferralBonus() — solo en el primer pago exitoso           │
└──────────────────────────────────────────────────────────────────────┘
```

### Lógica aditiva de la suscripción

`computeNextSubscriptionEnd(currentEndsAt, daysToAdd=30)`:

- Si la suscripción ya expiró → empieza desde **hoy** + 30 días.
- Si la suscripción **sigue activa** → suma 30 días al `subscription_ends_at` actual.

Esta política compartida también la usa NOWPayments. Es más justa que sobreescribir desde "ahora": un usuario que renueva una semana antes de expirar **conserva esa semana**.

---

## 2. Por qué webhook async + frontend dual-path

PayPal completa el pago en su sistema **antes** de que tu frontend reciba el callback `onApprove`. En ese intervalo pueden ocurrir varios fallos del lado del cliente que dejarían el pago confirmado en PayPal pero **sin reflejo en tu DB**:

| Escenario real | Frontend solo | Frontend + Webhook |
|---|---|---|
| Usuario cierra la pestaña tras autorizar | ❌ Pago perdido | ✅ Webhook completa |
| Internet del usuario se cae después de pagar | ❌ Pago perdido | ✅ Webhook completa |
| Bug JS rompe el callback `onApprove` | ❌ Pago perdido | ✅ Webhook completa |
| Doble click → dos requests de `capture` | ⚠️ Doble extensión | ✅ Idempotente (RPC `FOR UPDATE`) |
| Race entre frontend y webhook (ambos llegan) | ⚠️ Doble extensión | ✅ Solo uno gana, el otro recibe `already_processed` |

### Garantía de idempotencia

Ambos caminos terminan en el mismo RPC `fn_finalize_paypal_payment`. Dentro de Postgres:

```sql
SELECT * INTO v_invoice
FROM saas_invoices
WHERE np_invoice_id = p_order_id AND payment_method = 'paypal'
FOR UPDATE;             -- bloqueo de fila

IF v_invoice.status = 'finished' THEN
    RETURN 'already_processed';   -- el otro path ya completó
END IF;
```

`FOR UPDATE` serializa los accesos: aunque frontend y webhook lleguen exactamente al mismo tiempo, Postgres procesa uno y bloquea al otro hasta el commit. El segundo lee `status='finished'` y retorna `already_processed` sin tocar nada.

### Simulación del corte controlado (Test 3)

Probamos la red de seguridad sin esperar a que un usuario real se quede sin internet:

1. Abrir DevTools → Network tab → mantener visible.
2. Iniciar el pago, completarlo en el popup de PayPal.
3. **Al cerrarse el popup**, marcar inmediatamente la casilla `Offline` en Network.
4. El frontend pierde conexión y `capturePayPalOrderAction` falla.
5. PayPal envía el webhook desde sus servidores a Vercel — **el "Offline" del navegador no lo afecta**.
6. Vercel logs muestran `POST 200 /api/webhooks/paypal`.
7. Verificar DB: `saas_invoices.status='finished'`, `businesses.plan` activo, notificación creada.

Esta prueba se ejecutó en producción y validó que la red de seguridad funciona como diseñada.

---

## 3. Configuración en PayPal Developer

### Sandbox vs Live: dos universos paralelos

PayPal mantiene dos entornos completamente aislados, cada uno con sus propias apps, credenciales, webhooks y cuentas de prueba.

| | Sandbox | Live |
|---|---|---|
| Propósito | Desarrollo, QA, demos | Cobrar dinero real |
| Dashboard | developer.paypal.com → toggle **Sandbox** | toggle **Live** |
| API base | `https://api-m.sandbox.paypal.com` | `https://api-m.paypal.com` |
| Cuentas de prueba | Generadas automáticamente (Business + Personal) | No aplica |
| Tarjetas de prueba | Listado oficial en developer.paypal.com | Tarjetas reales |
| Riesgo de pago real | Cero | Total |

**Default seguro:** el código en `lib/payments/paypal.ts` usa Sandbox **a menos** que `PAYPAL_ENV=live` esté definido explícitamente. Ni siquiera `NODE_ENV=production` activa Live por sí solo. Esto previene cobros reales por un deploy mal configurado.

### Crear la app y obtener credenciales

1. Ir a developer.paypal.com → iniciar sesión.
2. Toggle superior → **Sandbox** (para pruebas) o **Live** (para producción).
3. Menú lateral → **Apps & Credentials**.
4. Click **Create App** (o usar la "Default Application" que PayPal genera automáticamente).
5. Anotar:
   - **Client ID** (público — se inlinea en el frontend bundle).
   - **Secret** (privado — nunca debe salir del servidor).

### Registrar el webhook

1. Dentro de la app seleccionada → scroll hasta sección **Webhooks**.
2. Click **Add Webhook**.
3. **URL:** `https://TU_DOMINIO/api/webhooks/paypal` (ejemplo: `https://cronix-app.vercel.app/api/webhooks/paypal`).
4. **Event types:** marcar únicamente **`PAYMENT.CAPTURE.COMPLETED`**.
5. **Save.**
6. Al guardar, PayPal muestra el **Webhook ID** generado (formato alfanumérico ~17 chars). Cópialo — lo necesitas para `PAYPAL_WEBHOOK_ID`.

> **Nota sobre el HTTP 401 al registrar:** cuando PayPal hace el ping inicial al webhook, recibe 401 porque no envía firma. Es el comportamiento correcto: el handler exige firma válida en todas las peticiones. PayPal acepta el registro de todas formas — el 401 no es bloqueante.

### Cuentas de prueba (Sandbox)

PayPal Sandbox genera automáticamente dos cuentas por defecto:

| Tipo | Email | Uso |
|---|---|---|
| **Business** | `sb-xxxx@business.example.com` | Receptor del pago (tu merchant ficticio) |
| **Personal** | `sb-xxxx@personal.example.com` | Comprador (buyer) — úsala para autorizar pagos |

Para obtener credenciales del **buyer Personal**:

1. developer.paypal.com → Sandbox → **Accounts**.
2. Localizar la cuenta tipo `Personal`.
3. Click los tres puntos a la derecha → **View/Edit Account**.
4. Copiar el **email** y revelar el **System Generated Password** con el icono del ojo.

### Evitar el bloqueo SMS en guest checkout

El flujo "Pay with Card" del popup de PayPal puede solicitar SMS de verificación al **(212) 555-1234** — un número ficticio donde nunca llega el código. Esto te deja atascado.

**Soluciones**:

1. **Usar el buyer Sandbox** (recomendado): en el popup, buscar el link **"Log in to PayPal"** o **"Tengo cuenta PayPal"** (usualmente arriba o lateral) y pegar las credenciales del buyer. Este flujo NO pide SMS.
2. **Si solo aparece el form de tarjeta**: completar con dirección US válida (`123 Main St, New York, NY 10001`). Algunos formularios sí proceden sin SMS.
3. **Inventar contraseña**: cuando solicite crear una password, cualquier valor funciona (ej: `Test12345!`) — es Sandbox, sin impacto real.

### Tarjetas de prueba

| Tipo | Número |
|---|---|
| Visa | `4111111111111111` |
| Visa (alt) | `4032039074540046` |
| Mastercard | `5425233430109903` |
| Amex | `374245455400126` |

Ver más en developer.paypal.com → Sandbox → **Credit cards for testing**.

---

## 4. Variables de entorno y matriz de scopes

### Variables requeridas

| Variable | Tipo | Inlining | Propósito |
|---|---|---|---|
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Public | Build-time (frontend) | Carga el SDK JS y crea órdenes desde el browser |
| `PAYPAL_CLIENT_SECRET` | Secret | Runtime (server) | Autenticación OAuth2 con la API REST de PayPal |
| `PAYPAL_WEBHOOK_ID` | Secret | Runtime (server) | Validación de firma de eventos `PAYMENT.CAPTURE.COMPLETED` |
| `PAYPAL_ENV` | Switch | Runtime (server) | Si vale `live` → API Production. Cualquier otro valor o ausente → Sandbox |

### Matriz de configuración por scope (Vercel)

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Client ID **Live** | Client ID **Sandbox** | Client ID **Sandbox** |
| `PAYPAL_CLIENT_SECRET` | Secret **Live** | Secret **Sandbox** | Secret **Sandbox** |
| `PAYPAL_WEBHOOK_ID` | Webhook ID **Live** | Webhook ID **Sandbox** | (no aplica si no hay webhook local) |
| `PAYPAL_ENV` | **`live`** | (sin definir) | (sin definir) |

### Reglas operativas

- **`PAYPAL_ENV=live` SOLO en scope Production.** Si lo defines en Preview, los deploys de PRs cobrarían dinero real.
- **NUNCA copies credenciales Live a `.env.local` de desarrollo local.** Tu máquina no necesita procesar pagos reales — para eso está Vercel Production.
- **Credenciales del mismo entorno deben venir de la misma app.** Mezclar Client ID Sandbox con Webhook ID Live (o viceversa) genera errores 400 en `/v1/notifications/verify-webhook-signature` porque PayPal no reconoce el webhook contra esa app.

### Ejemplo de configuración local (`.env.local`)

```bash
# PayPal — Sandbox (desarrollo local)
NEXT_PUBLIC_PAYPAL_CLIENT_ID=TU_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=TU_SANDBOX_CLIENT_SECRET
PAYPAL_WEBHOOK_ID=TU_SANDBOX_WEBHOOK_ID
# PAYPAL_ENV intencionalmente sin definir → fallback Sandbox
```

---

## 5. Configuración en Vercel

### Paso a paso para activar Live

> ⚠️ Solo cuando estés listo a procesar dinero real. Antes de esto, valida toda la suite de pruebas en Sandbox sobre el mismo deploy Vercel.

1. **Crear la app Live en PayPal** (si no existe):
   - developer.paypal.com → toggle **Live** → Apps & Credentials → Create App.
   - Anotar Client ID y Secret Live.

2. **Registrar webhook Live**:
   - Dentro de la app Live → Webhooks → Add.
   - URL: `https://TU_DOMINIO/api/webhooks/paypal`.
   - Evento: `PAYMENT.CAPTURE.COMPLETED`.
   - Copiar Webhook ID Live.

3. **Actualizar variables en Vercel** (Dashboard → tu proyecto → Settings → Environment Variables, scope **Production**):

   | Variable | Valor | Action |
   |---|---|---|
   | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Client ID Live | Edit existing → Save |
   | `PAYPAL_CLIENT_SECRET` | Secret Live | Edit existing → Save |
   | `PAYPAL_WEBHOOK_ID` | Webhook ID Live | Edit existing → Save |
   | `PAYPAL_ENV` | `live` | **Add New** → marcar solo Production |

4. **Redeploy sin cache**:
   - Vercel → Deployments → último deploy → menú `...` → **Redeploy**.
   - **Desmarcar** "Use existing build cache".

5. **Verificar entorno activo**:
   - Hacer un pago de prueba interno (de la cuenta del propio merchant a sí mismo, $1).
   - Revisar Vercel Logs: el log del webhook debe mostrar `apiBase: 'https://api-m.paypal.com'`.
   - Confirmar la fila `finished` en `saas_invoices`.

### Rollback de Live a Sandbox

Si necesitas regresar temporalmente a Sandbox (debugging, incidente):

1. Vercel → Environment Variables → `PAYPAL_ENV` → cambiar valor a cualquier cosa distinta de `live` (o eliminar la variable).
2. Cambiar las otras 3 vars a sus valores Sandbox.
3. Redeploy sin cache.

---

## 6. Suite de pruebas operacionales

Suite ejecutada y validada en `https://cronix-app.vercel.app` durante la integración. Todos los tests pasaron en el ambiente Sandbox.

### Test 1 — Pago feliz end-to-end

**Objetivo:** validar la cadena completa desde click hasta DB.

**Pasos:**

1. Reset estado: `DELETE FROM saas_invoices WHERE payment_method='paypal'; UPDATE businesses SET plan='free', subscription_ends_at=NULL WHERE owner_id=...`.
2. Login en Cronix → Plans → Pro $10 → PayPal.
3. Login en popup con buyer Sandbox → "Complete Purchase".
4. Verificar:
   - `saas_invoices`: una fila `status='finished'`, `amount_usd=10`, `plan_purchased='pro'`.
   - `businesses`: `plan='pro'`, `subscription_ends_at ≈ NOW() + 30 days`.
   - `notifications`: `"¡Pago Confirmado! 🎉"` con `metadata.payment_method='paypal'`.

**Resultado:** ✅ Pasado.

### Test 2 — Idempotencia (no doble extensión)

**Objetivo:** la RPC rechaza re-ejecuciones sobre facturas ya `finished`.

```sql
-- Snapshot del estado actual
SELECT subscription_ends_at FROM businesses WHERE owner_id=...;
-- Anotar: T0

-- Intento de re-finalizar el mismo orderId
SELECT * FROM fn_finalize_paypal_payment('ORDER_ID_DEL_TEST_1', 10, 30);
-- Esperado: result_status='already_processed'

-- Re-leer estado
SELECT subscription_ends_at FROM businesses WHERE owner_id=...;
-- Esperado: T0 idéntico, sin extensión adicional
```

**Resultado:** ✅ `already_processed`, `subscription_ends_at` sin cambios.

### Test 2b — Amount mismatch

**Objetivo:** la RPC rechaza montos manipulados antes de tocar la DB.

```sql
-- Tomar una factura waiting (de un pago abandonado)
SELECT np_invoice_id FROM saas_invoices WHERE payment_method='paypal' AND status='waiting' LIMIT 1;
-- Resultado: ORDER_ID_WAITING

-- Intentar finalizar con monto inválido
SELECT * FROM fn_finalize_paypal_payment('ORDER_ID_WAITING', 0.01, 30);
-- Esperado: result_status='amount_mismatch'
```

**Resultado:** ✅ `amount_mismatch`.

### Test 3 — Webhook como red de seguridad

**Objetivo:** un pago completa el fulfillment aun si el frontend muere.

**Pasos:**

1. Reset estado (mismo SQL del Test 1).
2. Abrir DevTools → Network tab → mantener visible.
3. Iniciar pago en la UI → completar autorización en popup PayPal.
4. **Al cerrarse el popup**, marcar inmediatamente `Offline` en Network → frontend no puede llamar a `capturePayPalOrderAction`.
5. Esperar 30–60 segundos.
6. Quitar Offline. Verificar Vercel Logs: aparece `POST 200 /api/webhooks/paypal`.
7. Verificar DB: las mismas 3 tablas del Test 1 reflejan el pago completo.

**Resultado:** ✅ Pasado en producción (Vercel Sandbox). El webhook completó factura + plan + notificación sin participación del navegador del usuario.

---

## 7. Logs de validación y observabilidad

### Log de entorno activo

Cuando el webhook falla la verificación, el handler emite un log estructurado que delata el entorno y el webhook ID en uso:

```
[PayPal Webhook] Verification API error: {
  status: 400,
  body: '<respuesta cruda de PayPal>',
  sentWebhookIdLength: 17,
  sentWebhookIdFirstChars: 'WH123456',
  apiBase: 'https://api-m.sandbox.paypal.com'
}
```

| Campo | Para qué sirve |
|---|---|
| `status` | Código HTTP que devolvió PayPal en `/v1/notifications/verify-webhook-signature` |
| `body` | Respuesta cruda — describe el error real (formato, webhook_id desconocido, etc.) |
| `sentWebhookIdLength` | Longitud del `PAYPAL_WEBHOOK_ID` enviado. Detecta truncamientos por copy-paste |
| `sentWebhookIdFirstChars` | Primeros 8 chars del webhook ID. Permite comparar contra el de PayPal Dashboard sin filtrar el valor completo a logs |
| `apiBase` | `https://api-m.paypal.com` = Live; `https://api-m.sandbox.paypal.com` = Sandbox. **Verifica que coincide con el entorno esperado** |

### Cómo leer los logs en Vercel

1. Vercel Dashboard → tu proyecto → tab **Logs** (arriba).
2. Activar toggle **Live** (esquina superior derecha).
3. Filtrar:
   - `/api/webhooks/paypal` → eventos del webhook.
   - `paypal` (texto libre) → cualquier log relacionado.
4. Cada entrada muestra: timestamp · método HTTP · status · payload del `console.log/error`.

### Entradas relevantes por escenario

| Evento | Log esperado |
|---|---|
| Webhook recibido y procesado | `POST 200 /api/webhooks/paypal` |
| Firma inválida | `POST 401 /api/webhooks/paypal` + `[PayPal Webhook] Verification API error: ...` |
| Body no parseable | `POST 400 /api/webhooks/paypal` |
| Evento ignorado (no es CAPTURE.COMPLETED) | `POST 200` con body `{ received: true, ignored: '<event_type>' }` |
| Orden no existe en DB | `POST 200` con warning `[PayPal Webhook] Order not found in saas_invoices` |
| Amount mismatch | `POST 400` + error log `[PayPal Webhook] Amount mismatch` |

### Verificar el entorno activo sin hacer un pago

Cualquier intento de webhook (genuino o malicioso) deja huella del `apiBase`. Si te preocupa una mala configuración:

1. Espera el siguiente intento de pago real (o usa PayPal Dashboard → Webhooks → Send Test Notification, que envía un evento firmado).
2. Filtra logs por `apiBase`.
3. Confirma `https://api-m.paypal.com` para Live o `https://api-m.sandbox.paypal.com` para Sandbox.

---

## 8. Garantías de seguridad

| Riesgo | Mitigación |
|---|---|
| **IDOR — captura ajena** | `capturePayPalOrderAction` requiere `auth.getUser()` + verifica que `saas_invoices.business_id` pertenece al usuario logueado antes de llamar PayPal |
| **Doble cobro / doble extensión** | RPC con `FOR UPDATE` lock + condición `status != 'finished'` ⇒ idempotente |
| **Monto manipulado en orden** | RPC compara `p_captured_amount` vs `amount_usd` con tolerancia de $0.01 ⇒ `amount_mismatch` |
| **Webhook falsificado** | `verifyWebhookSignature` llama a la API oficial PayPal con headers + body + webhook_id ⇒ solo procesa eventos cuyo `verification_status='SUCCESS'` |
| **Fail-closed sin webhook_id** | Si `PAYPAL_WEBHOOK_ID` no está configurado, `verifyWebhookSignature` devuelve `false` y el handler retorna 401 |
| **Cobro real accidental** | `PAYPAL_ENV=live` es opt-in explícito. Default = Sandbox en TODOS los entornos (incluyendo Vercel Production con `NODE_ENV=production`) |
| **Fulfillment no atómico** | RPC `fn_finalize_paypal_payment` ejecuta invoice UPDATE + business UPDATE en una transacción Postgres ⇒ todo o nada |
| **Side effects rompen el commit** | `INSERT notifications` y `applyReferralBonus` se ejecutan **fuera** de la transacción; si fallan no rompen el pago ya completado |
| **CSP bloquea SDK** | `next.config.js` incluye `*.paypal.com` / `*.paypalobjects.com` en `script-src`, `frame-src`, `connect-src`, `img-src`, `font-src`, `form-action` |
| **COOP rompe popup** | `Cross-Origin-Opener-Policy: same-origin-allow-popups` permite que la ventana de PayPal hable con la principal vía `window.opener.postMessage` |

### Notification type constraint

La tabla `notifications` tiene `CHECK (type IN ('info','success','warning','error'))`. El código usa:

| Evento | type |
|---|---|
| Pago confirmado | `'success'` |
| Pago parcial cripto | `'warning'` |
| Pago manual rechazado | `'error'` |
| Bono de referido | `'success'` |

Valores fuera de este enum hacen que el INSERT falle silenciosamente (Supabase devuelve `{error}` sin lanzar). Por eso `subscription-fulfillment.ts` ahora **chequea el error** del insert de notificación y lo loguea.

---

## 9. Runbook de incidentes

### Síntoma: usuario reporta pago confirmado en PayPal pero el plan no se activó

**Diagnóstico:**

1. Buscar en `saas_invoices` por su `business_id`:

   ```sql
   SELECT id, status, np_invoice_id, amount_usd, created_at, updated_at
   FROM saas_invoices
   WHERE business_id = 'BUSINESS_ID_DEL_USUARIO'
   ORDER BY created_at DESC LIMIT 5;
   ```

2. Si la fila más reciente es `waiting` → el fulfillment falló o aún no llegó.
3. Revisar PayPal Dashboard → Webhooks → Notification History. Ver si el evento `PAYMENT.CAPTURE.COMPLETED` para ese orderId existe y su delivery status.
4. Revisar Vercel Logs filtrando por el `orderId`.

**Resolución manual (solo si todo lo demás falla):**

```sql
-- Re-disparar el fulfillment manualmente
SELECT * FROM fn_finalize_paypal_payment('ORDER_ID', AMOUNT_USD, 30);
```

Si devuelve `completed` → el plan queda activo. Si devuelve `amount_mismatch` o `invoice_not_found` → escalar al desarrollador.

### Síntoma: webhook devuelve 401 reiteradamente

**Causa más probable:** `PAYPAL_WEBHOOK_ID` no coincide con el webhook que envió el evento. Suele pasar por:

1. Credenciales mezcladas entre Sandbox/Live.
2. Webhook ID copiado con caracteres truncados.
3. Webhook re-creado en PayPal (genera nuevo ID) pero no actualizado en Vercel.

**Resolución:**

1. Revisar logs — el nuevo handler imprime `sentWebhookIdLength` y `sentWebhookIdFirstChars`.
2. Comparar contra el Webhook ID en developer.paypal.com → app activa → Webhooks.
3. Si difieren: corregir en Vercel Environment Variables → Redeploy sin cache.

### Síntoma: pago Sandbox no cobra real, pero apareció en Live

**Causa:** `PAYPAL_ENV=live` está activo en un scope incorrecto (Preview o Development).

**Resolución inmediata:**

1. Vercel → Environment Variables → `PAYPAL_ENV` → confirmar que **solo Production** está marcado.
2. Si está marcado en otros scopes → quitarlos → Save → Redeploy.

### Síntoma: notificación de "Pago Confirmado" no aparece pero el plan sí se activó

**Causa típica:** valor de `type` no válido en el INSERT a `notifications`.

**Diagnóstico:**

```sql
-- Buscar la notificación esperada
SELECT * FROM notifications
WHERE business_id = 'BUSINESS_ID' AND created_at >= NOW() - INTERVAL '1 hour';
```

Si no existe, revisar Vercel Logs por `[Fulfillment] Notification insert failed`. El error de Postgres detalla qué constraint violó.

**Backfill manual:**

```sql
INSERT INTO notifications (business_id, title, content, type, metadata)
VALUES (
  'BUSINESS_ID',
  '¡Pago Confirmado! 🎉',
  'Tu plan PRO ha sido activado exitosamente.',
  'success',
  jsonb_build_object('invoice_id', 'INVOICE_ID', 'payment_method', 'paypal', 'backfilled', true)
);
```

---

## Referencias

- [PayPal Webhooks API](https://developer.paypal.com/api/rest/webhooks/)
- [PayPal Orders v2 API](https://developer.paypal.com/docs/api/orders/v2/)
- [@paypal/react-paypal-js docs](https://paypal.github.io/react-paypal-js/)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)

### Archivos clave (mapa rápido)

| Capa | Archivo |
|---|---|
| UI botones | `app/[locale]/dashboard/settings/payment-method-modal.tsx` |
| Server actions | `app/[locale]/dashboard/settings/actions.ts` |
| SDK adapter | `lib/payments/paypal.ts` |
| Fulfillment compartido | `lib/payments/subscription-fulfillment.ts` |
| Webhook | `app/api/webhooks/paypal/route.ts` |
| RPC atómica | `supabase/migrations/20260516130000_paypal_finalize_rpc.sql` |
| CSP / COOP | `next.config.js` |
| SW kill-switch dev | `app/layout.tsx` |
