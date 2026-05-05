# Payments & Plan System — Cronix

> Documento de referencia completo para la integración de pagos con NOWPayments, el sistema de planes SaaS y la aplicación de límites en toda la plataforma.

---

## Tabla de Contenidos

1. [Visión General](#1-visión-general)
2. [Planes y Precios](#2-planes-y-precios)
3. [Esquema de Base de Datos](#3-esquema-de-base-de-datos)
4. [Fuente Única de Verdad — plan-limits.ts](#4-fuente-única-de-verdad--plan-limitsts)
5. [Flujo de Pago Completo](#5-flujo-de-pago-completo)
6. [NOWPayments API Client](#6-nowpayments-api-client)
7. [Server Action — createSaaSCheckoutSession](#7-server-action--createsaascheckoutsession)
8. [Webhook IPN — /api/webhooks/nowpayments](#8-webhook-ipn--apiwebhooksnowpayments)
9. [Queue Worker — /api/queue/process-saas-payment](#9-queue-worker--apiqueueprocess-saas-payment)
10. [Cron Job — /api/cron/check-subscriptions](#10-cron-job--apicroncheck-subscriptions)
11. [Aplicación de Límites del Plan](#11-aplicación-de-límites-del-plan)
12. [UI — Plan & Recompensas](#12-ui--plan--recompensas)
13. [Internacionalización de Errores de Plan](#13-internacionalización-de-errores-de-plan)
14. [Variables de Entorno](#14-variables-de-entorno)
15. [Tests Unitarios](#15-tests-unitarios)
16. [Seguridad](#16-seguridad)
17. [Migraciones de Base de Datos](#17-migraciones-de-base-de-datos)
18. [Sistema de Referidos](#18-sistema-de-referidos)

---

## 1. Visión General

Cronix usa **NOWPayments** como pasarela de pago en criptomonedas (USDT TRC-20). El flujo está diseñado para ser:

- **Idempotente**: QStash garantiza que cada estado de pago se procese exactamente una vez, sin importar cuántas veces llegue el webhook.
- **Tolerante a fallos**: el webhook retorna `200 OK` inmediatamente a NOWPayments y delega el procesamiento pesado a la cola. Evita timeouts de Vercel.
- **Asíncrono**: el negocio recibe una notificación in-app cuando el plan se activa.

```
Usuario → PlanManager UI
    → createSaaSCheckoutSession (Server Action)
        → NOWPayments API → Invoice URL
User abre link → paga en cripto
    → NOWPayments IPN Webhook → /api/webhooks/nowpayments
        → QStash (dedup por payment_id + status)
            → /api/queue/process-saas-payment
                → Actualiza saas_invoices
                → Si finished → actualiza businesses.plan + subscription_ends_at
                → Crea notificación in-app
```

---

## 2. Planes y Precios

| Plan       | Precio      | Clientes | Empleados | Citas/mes  |
|------------|-------------|----------|-----------|------------|
| Free       | $0          | 20       | 1 (dueño) | 30         |
| Pro        | $10 USDT/mes | Ilimitados | 3       | Ilimitadas |
| Enterprise | $15 USDT/mes | Ilimitados | Ilimitados | Ilimitadas |

Todas las funcionalidades (agenda, servicios, finanzas, reportes, WhatsApp, asistente IA) están disponibles en todos los planes. Los límites solo aplican a volumen.

---

## 3. Esquema de Base de Datos

### Enum `business_plan`

```sql
CREATE TYPE "public"."business_plan" AS ENUM ('free', 'pro', 'enterprise');
```

### Columnas en `businesses`

| Columna                | Tipo        | Default  | Descripción                                   |
|------------------------|-------------|----------|-----------------------------------------------|
| `plan`                 | business_plan | `'free'` | Plan activo del negocio                      |
| `subscription_ends_at` | TIMESTAMPTZ | NULL     | Fecha de expiración de la suscripción pagada |

### Tabla `saas_invoices`

```sql
CREATE TABLE public.saas_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  np_invoice_id    TEXT NOT NULL UNIQUE,   -- ID de la factura en NOWPayments
  np_payment_id    TEXT,                   -- ID del pago en NOWPayments (llega por webhook)
  amount_usd       DECIMAL(10,2) NOT NULL, -- Monto en USD
  crypto_amount    DECIMAL(16,8),          -- Monto pagado en cripto (llega por webhook)
  crypto_currency  TEXT,                   -- Moneda usada (ej. 'usdtbep20', 'binancepay')
  status           saas_invoice_status NOT NULL DEFAULT 'waiting',
  plan_purchased   business_plan NOT NULL, -- Plan que se estaba comprando
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Enum `saas_invoice_status`

```sql
CREATE TYPE saas_invoice_status AS ENUM (
  'waiting',       -- Factura creada, esperando pago
  'confirming',    -- Pago detectado, esperando confirmaciones en blockchain
  'finished',      -- Pago confirmado completamente → plan activado
  'partially_paid',-- Se recibió menos del monto requerido
  'failed',        -- El pago falló
  'expired',       -- La factura expiró sin pago
  'refunded'       -- El pago fue reembolsado
);
```

### RLS (Row Level Security)

- **SELECT**: usuarios autenticados pueden ver sus propias facturas (via `business_id`).
- **INSERT/UPDATE**: solo el `service_role` (webhooks y server actions con `createAdminClient()`). Los usuarios no pueden escribir directamente.

### Índices

```sql
CREATE INDEX idx_saas_invoices_np_invoice_id ON public.saas_invoices(np_invoice_id);
CREATE INDEX idx_saas_invoices_np_payment_id ON public.saas_invoices(np_payment_id);
CREATE INDEX idx_saas_invoices_business_id ON public.saas_invoices(business_id);
CREATE INDEX idx_businesses_subscription_ends_at ON public.businesses(subscription_ends_at);
```

---

## 4. Fuente Única de Verdad — `plan-limits.ts`

**Archivo**: `lib/plans/plan-limits.ts`

Este archivo es la **única** fuente de verdad para todos los límites y constantes de negocio. Cualquier cambio se propaga automáticamente a todos los puntos de aplicación (acciones del servidor, herramientas de IA, UI, sistema de referidos).

```typescript
// ── Constantes de referidos ──────────────────────────────────────────────────
export const MAX_BONUS_APPOINTMENTS = 50  // tope de citas extra por referidos (plan free)
export const REFERRAL_BONUS_DAYS    = 30  // días extra otorgados al referidor (plan pagado)

// ── Límites por plan ─────────────────────────────────────────────────────────
export const PLAN_LIMITS = {
  free:       { clients: 20,       employees: 1,        appointmentsPerMonth: 30       },
  pro:        { clients: Infinity, employees: 3,        appointmentsPerMonth: Infinity },
  enterprise: { clients: Infinity, employees: Infinity, appointmentsPerMonth: Infinity },
} as const

export type PlanKey = keyof typeof PLAN_LIMITS

export function getClientLimit(plan: string): number
export function getEmployeeLimit(plan: string): number
export function getAppointmentMonthLimit(business: { plan: string; bonus_appointments_limit?: number | null }): number
export function canAccessReports(plan: string): boolean  // true para pro y enterprise
export function isFreePlan(plan: string): boolean
```

> **Regla**: Nunca hardcodear límites ni constantes de referidos en la UI ni en las acciones. Siempre importar desde aquí.

---

## 5. Flujo de Pago Completo

### Paso 1 — Usuario abre el modal de planes

`app/[locale]/dashboard/settings/plan-manager.tsx` — componente `'use client'` que muestra la tabla comparativa de planes y los botones de activación.

### Paso 2 — Clic en "Activar Pro" o "Activar Enterprise"

Llama a `createSaaSCheckoutSession(plan)` (Server Action) que:
1. Verifica la sesión del usuario.
2. Obtiene el `business_id` del usuario autenticado.
3. Crea una factura en NOWPayments API con `order_id = ${businessId}-${Date.now()}` (el timestamp garantiza unicidad).
4. Inserta un registro `waiting` en `saas_invoices` usando `createAdminClient()` (bypassa RLS).
5. Retorna `{ invoice_url }`.

### Paso 3 — Usuario paga en la página de NOWPayments

El usuario abre el `invoice_url` en una nueva pestaña y realiza el pago en USDT TRC-20.

### Paso 4 — NOWPayments envía IPN Webhook

NOWPayments hace `POST /api/webhooks/nowpayments` con el payload de cambio de estado, incluyendo la firma HMAC-SHA512 en el header `x-nowpayments-sig`.

### Paso 5 — Webhook verifica firma y encola

El webhook:
1. Extrae el body crudo como texto (necesario para verificar HMAC).
2. Verifica la firma criptográfica con `nowpayments.verifyIpnSignature()`.
3. Encola el payload en **QStash** con `Upstash-Deduplication-Id: ${paymentId}_${paymentStatus}`.
4. Retorna `200 OK` de inmediato.

### Paso 6 — QStash procesa el trabajo

QStash hace `POST /api/queue/process-saas-payment` (verificado por `verifySignatureAppRouter`):
1. Normaliza el estado de NOWPayments al enum de la DB.
2. Actualiza `saas_invoices` con el nuevo estado.
3. Si `status === 'finished'`: actualiza `businesses.plan` y calcula `subscription_ends_at = ahora + 1 mes`.
4. Crea una notificación in-app.
5. Si `status === 'partially_paid'`: crea una notificación de alerta para soporte.

### Paso 7 — Realtime en el navegador

`PlanManager` tiene un listener de Supabase Realtime sobre `businesses` filtrado por `id=eq.${businessId}`. Cuando detecta un cambio de plan, recarga la página con `window.location.reload()` para mostrar el nuevo plan.

---

## 6. NOWPayments API Client

**Archivo**: `lib/payments/nowpayments.ts`

Clase `NOWPaymentsAPI` con singleton exportado `nowpayments`.

### `createInvoice(params)`

```typescript
nowpayments.createInvoice({
  price_amount:      10.00,
  price_currency:    'usd',
  pay_currency:      'usdtbsc', // NOWPayments code for USDT on BSC (BEP-20)
  order_id:          `${businessId}-${Date.now()}`,
  order_description: 'cronix-pro',
  success_url:       `${APP_URL}/dashboard/settings?payment=success`,
  cancel_url:        `${APP_URL}/dashboard/settings?payment=cancel`,
})
// → { invoice_url, invoice_id } | { error }
```

Hace `POST https://api.nowpayments.io/v1/invoice` con header `x-api-key`.

> `pay_currency: 'usdtbsc'` es el código correcto de NOWPayments para USDT en Binance Smart Chain (BEP-20). El código `usdtbep20` retorna `INVALID_REQUEST_PARAMS` — no existe en su API.

### `verifyIpnSignature(payload, signature)`

Recrea el HMAC-SHA512 con `NOWPAYMENTS_IPN_SECRET`. NOWPayments ordena las claves del payload alfabéticamente antes de firmar — la implementación replica este comportamiento:

```typescript
const sortedKeys = Object.keys(payload).sort()
const sortedPayload = {}
for (const key of sortedKeys) sortedPayload[key] = payload[key]
const stringPayload = JSON.stringify(sortedPayload)

const hmac = crypto.createHmac('sha512', this.ipnSecret)
hmac.update(stringPayload)
return hmac.digest('hex') === signature
```

### Sandbox

Para pruebas locales, cambiar `NOWPAYMENTS_API_URL` a `https://api.sandbox.nowpayments.io/v1`.

---

## 7. Server Action — `createSaaSCheckoutSession`

**Archivo**: `app/[locale]/dashboard/settings/actions.ts`

```typescript
'use server'

export async function createSaaSCheckoutSession(plan: 'pro' | 'enterprise') {
  // 1. Autenticación: obtiene user de la sesión
  // 2. Obtiene business_id del usuario autenticado
  // 3. amountUsd = plan === 'pro' ? 10.00 : 15.00
  // 4. orderId = `${business.id}-${Date.now()}` (único por intento)
  // 5. nowpayments.createInvoice(...)
  // 6. supabaseAdmin.from('saas_invoices').insert({ status: 'waiting', ... })
  // 7. return { invoice_url }
}
```

**Notas importantes**:
- Usa `createAdminClient()` (service role) para insertar en `saas_invoices`, que no permite INSERT por usuarios autenticados.
- El `Date.now()` en el `order_id` evita que NOWPayments rechace una factura por `order_id` duplicado si el usuario intenta pagar más de una vez.

---

## 8. Webhook IPN — `/api/webhooks/nowpayments`

**Archivo**: `app/api/webhooks/nowpayments/route.ts`

```
POST /api/webhooks/nowpayments
Headers: x-nowpayments-sig: <hmac-sha512-hex>
Body: JSON payload de NOWPayments
```

**Flujo**:
1. Lee el body como texto plano (`req.text()`) antes de parsear — necesario para la verificación de firma.
2. Verifica `x-nowpayments-sig` → `401` si falta o es inválida.
3. Encola en QStash con deduplicación por `${paymentId}_${paymentStatus}`.
4. Retorna `200 OK` sin esperar resultado del worker.

**Por qué QStash**: NOWPayments puede reenviar el mismo webhook varias veces (por reintentos). Sin deduplicación, se activaría el plan múltiples veces. QStash garantiza que el mismo `payment_id + status` se procese exactamente una vez.

---

## 9. Queue Worker — `/api/queue/process-saas-payment`

**Archivo**: `app/api/queue/process-saas-payment/route.ts`

```
POST /api/queue/process-saas-payment
```

Protegida con `verifySignatureAppRouter` de QStash — solo QStash puede llamar a esta ruta.

### Mapeo de estados NOWPayments → DB

| NOWPayments status     | DB status       |
|------------------------|-----------------|
| `waiting`              | `waiting`       |
| `confirming`           | `confirming`    |
| `confirmed`            | `confirming`    |
| `sending`              | `confirming`    |
| `partially_paid`       | `partially_paid`|
| `finished`             | `finished`      |
| `failed`               | `failed`        |
| `refunded`             | `refunded`      |
| `expired`              | `expired`       |

### Cuando `status === 'finished'`

```typescript
const endsAt = new Date()
endsAt.setMonth(endsAt.getMonth() + 1) // suscripción de 30 días aprox.

supabaseAdmin.from('businesses').update({
  plan: invoice.plan_purchased,
  subscription_ends_at: endsAt.toISOString(),
})

supabaseAdmin.from('notifications').insert({
  title: '¡Pago Confirmado! 🎉',
  content: `Tu plan ${invoice.plan_purchased.toUpperCase()} ha sido activado exitosamente.`,
  type: 'billing',
})

// Aplica bonus de referido si aplica (ver §18)
await applyReferralBonus(invoice.business_id)
```

### `applyReferralBonus(businessId)` — función privada del worker

Extraída del handler principal para mantener el SRP. Se ejecuta solo cuando `status === 'finished'`.

```typescript
async function applyReferralBonus(businessId: string): Promise<void>
```

**Lógica**:

1. Obtiene `referred_by_id` del negocio que acaba de pagar.
2. Si no tiene referidor → termina sin efecto.
3. Verifica que este sea el **primer** pago finalizado del negocio (`count === 1` en `saas_invoices` con `status = 'finished'`). Garantiza que el bonus se aplica una sola vez.
4. Obtiene el plan actual del referidor.
5. Si el referidor tiene plan `free` → no recibe bonus de meses (ese modelo solo aplica a planes pagados).
6. Si el referidor tiene plan pagado (`pro` / `enterprise`) → extiende su `subscription_ends_at` en `REFERRAL_BONUS_DAYS` días.
7. Crea notificación in-app para el referidor.

> **Nota**: el bonus para el plan Free (citas extra) se aplica en el momento del registro del negocio invitado, no aquí. Ver §18.4.

### Cuando `status === 'partially_paid'`

Crea una notificación de tipo `'alert'` indicando cuánto se recibió y en qué moneda, para que soporte pueda contactar al cliente.

---

## 10. Cron Job — `/api/cron/check-subscriptions`

**Archivo**: `app/api/cron/check-subscriptions/route.ts`

```
GET|POST /api/cron/check-subscriptions
```

Protegida con `verifySignatureAppRouter` de QStash — se programa como un CRON periódico en QStash.

**Propósito**: Degradar a `free` todos los negocios con plan pagado cuya `subscription_ends_at` ya pasó.

```typescript
// 1. Busca negocios con plan != 'free' AND subscription_ends_at < now
// 2. Los degrada masivamente a plan = 'free', subscription_ends_at no se toca
// 3. Retorna { success, downgraded: N, businesses: [ids] }
```

**Frecuencia recomendada**: diariamente (cada 24h) o dos veces al día.

> **Nota**: Las notificaciones de expiración próxima (ej. "tu plan expira en 3 días") no están implementadas aún. Se pueden agregar aquí o como cron separado.

---

## 11. Aplicación de Límites del Plan

Los límites se verifican en **tres capas** independientes:

### Capa 1 — Server Action: Clientes

**Archivo**: `app/[locale]/dashboard/clients/actions.ts` → `createNewClient()`

```typescript
import { getClientLimit } from '@/lib/plans/plan-limits'
import { getTranslations } from 'next-intl/server'

const limit = getClientLimit(biz?.plan ?? 'free')
if (isFinite(limit)) {
  const { count } = await supabase.from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', input.businessId)
    .is('deleted_at', null)

  if ((count ?? 0) >= limit) {
    const t = await getTranslations('settings.plan.limitErrors')
    return { error: t('clients', { limit }) }
  }
}
```

### Capa 2 — Server Action: Empleados

**Archivo**: `app/[locale]/dashboard/team/actions.ts` → `createEmployeeAction()`

```typescript
import { getEmployeeLimit } from '@/lib/plans/plan-limits'

const limit = getEmployeeLimit(biz?.plan ?? 'free')
if (isFinite(limit)) {
  const currentCount = teamResult.data?.length ?? 0
  if (currentCount >= limit) {
    const t = await getTranslations('settings.plan.limitErrors')
    throw new Error(t('employees', { limit, plan: (biz?.plan ?? 'free').toUpperCase() }))
  }
}
```

### Capa 3 — Client Hook: Citas mensuales (con bonus de referidos)

**Archivo**: `app/[locale]/dashboard/appointments/new/hooks/use-appointment-form.ts`

Usa el helper `checkAppointmentLimit()` antes de crear la cita:

```typescript
import { checkAppointmentLimit } from '@/lib/actions/check-appointment-limit'

const limitCheck = await checkAppointmentLimit(businessId)
if (!limitCheck.allowed) {
  setMsg({ type: 'limit_error', text: tPlan('appointments', { limit: limitCheck.limit }) })
  return
}
```

Cuando el tipo del mensaje es `'limit_error'` (en vez de `'error'`), la UI muestra además una CTA de referidos que lleva a `/dashboard/plans`, invitando al usuario a ganar más citas invitando negocios en lugar de simplemente bloquear la acción.

**Archivo helper**: `lib/actions/check-appointment-limit.ts`

```typescript
export async function checkAppointmentLimit(businessId: string): Promise<{
  allowed: boolean
  current: number
  limit: number
  plan: string
}>
```

El límite efectivo se calcula con `getAppointmentMonthLimit({ plan, bonus_appointments_limit })`, sumando el bonus de referidos al base del plan:

```typescript
// Plan free con 2 referidos: 30 + 20 = 50 citas/mes efectivas
getAppointmentMonthLimit({ plan: 'free', bonus_appointments_limit: 20 }) // → 50
```

Cuenta citas del mes actual con status distinto de `cancelled` o `no_show`.

### Capa 4 — Herramienta de IA: Citas

**Archivo**: `lib/ai/tools/appointment.tools.ts` → función `book_appointment()`

El asistente IA Luis también verifica el límite antes de agendar, para que no pueda saltarse los límites por voz o chat.

### Resumen de puntos de aplicación

| Recurso   | Archivo                                | Función              | Tipo   |
|-----------|----------------------------------------|----------------------|--------|
| Clientes  | `clients/actions.ts`                   | `createNewClient()`  | Server |
| Empleados | `team/actions.ts`                      | `createEmployeeAction()` | Server |
| Citas     | `check-appointment-limit.ts` + hook    | `checkAppointmentLimit()` | Server+Client |
| Citas (IA)| `lib/ai/tools/appointment.tools.ts`    | `book_appointment()` | Server |

---

## 12. UI — Plan & Recompensas

### Página unificada — `/dashboard/plans`

**Archivo**: `app/[locale]/dashboard/plans/page.tsx`

Server Component que centraliza toda la información de monetización del negocio. Reemplaza la anterior ubicación de `PlanManager` en Ajustes.

**Estructura visual**:
```
Plan & Recompensas
├── Tu Plan Actual
│   └── <PlanManager> — comparador + modal de upgrade
└── Programa de Referidos
    └── <ReferralClient> — enlace referido + progreso + lista de invitados
```

**Data fetching** (un único `createAdminClient()` para ambas secciones):
```typescript
// Datos del negocio (sirven a ambos hijos)
const { data: business } = await adminSupabase
  .from("businesses")
  .select("id, name, plan, referral_code, bonus_appointments_limit, subscription_ends_at")
  .eq("id", dbUser.business_id)
  .single()

// Lista de negocios que usaron el código de este negocio
const { data: invited } = await adminSupabase
  .from("businesses")
  .select("id, name, plan, created_at")
  .eq("referred_by_id", business.id)
  .order("created_at", { ascending: false })
```

### PlanManager

**Archivo**: `app/[locale]/dashboard/settings/plan-manager.tsx`

Componente `'use client'` que:

1. Muestra el plan actual con `t('current', { plan })` (ICU select).
2. Abre un modal con tabla comparativa de planes.
3. Al pulsar "Activar Pro/Enterprise", llama a `createSaaSCheckoutSession(plan)` y abre el `invoice_url` en nueva pestaña.
4. Escucha cambios Realtime de Supabase en `businesses` filtrado por `id=eq.${businessId}` — recarga la página cuando el plan cambia.

### Puntos de entrada al flujo

| Ubicación | Componente | Acción |
|---|---|---|
| Sidebar | `Gem` icon → "Plan & Recompensas" | Navega a `/dashboard/plans` |
| Ajustes | CTA card "🎁 ¡Gana más citas gratis!" | Navega a `/dashboard/plans` |
| Nueva cita (límite alcanzado) | CTA banner `limit_error` | Navega a `/dashboard/plans` |
| `/dashboard/referrals` (URL directa) | Redirect automático | Redirige a `/dashboard/plans` |

### Nota sobre el contador de clientes

**Archivo**: `app/[locale]/dashboard/clients/clients-view.tsx`

Muestra el uso actual del límite en el header de la vista:

```tsx
{t('limitBadge', { current: initialClients.length, limit: clientLimit })}
// → "15/20 clientes" (es) | "15/20 clients" (en) | etc.
```

---

## 13. Internacionalización de Errores de Plan

Todos los mensajes de error de límites y la UI del modal están completamente internacionalizados en 6 idiomas: **es, en, de, fr, it, pt**.

### Namespace `settings.plan`

Claves en `messages/{locale}.json`:

```json
"plan": {
  "current": "Plan {plan, select, free {Gratuito} pro {Pro} enterprise {Empresa} other {Gratuito}}",
  "fullAccess": "Acceso completo incluido",
  "managePlan": "Gestionar plan",
  "modalTitle": "Planes de Cronix",
  "currentPlanLabel": "Plan actual:",
  "freeLimitNote": "Límite de 20 clientes, 1 empleado y 30 citas/mes",
  "tableFeature": "Característica",
  "tableClients": "Clientes",
  "tableEmployees": "Empleados",
  "tableAppts": "Citas / mes",
  "tableAiAssistant": "Asistente IA Luis",
  "tableCalendar": "Agenda y servicios",
  "tableFinance": "Finanzas",
  "tableReports": "Reportes",
  "tableWhatsapp": "WhatsApp",
  "tableBranches": "Sucursales",
  "tableUpTo20": "Hasta 20",
  "tableUpTo3": "Hasta 3",
  "tableUpTo30": "Hasta 30",
  "tableOwnerOnly": "1 (dueño)",
  "tableUnlimited": "Ilimitados",
  "tableUnlimitedAppts": "Ilimitadas",
  "tableComingSoon": "Próximamente",
  "tablePricePerMonth": "Precio / mes",
  "activatePro": "Activar Pro — $10 USDT",
  "activateEnterprise": "Activar Enterprise — $15 USDT",
  "proActive": "Plan Pro activo",
  "enterpriseActive": "Plan Enterprise activo",
  "paymentNote": "Pago en USDT TRC-20 vía NOWPayments...",
  "errorInternal": "Error interno. Inténtalo de nuevo.",
  "limitErrors": {
    "clients": "Has alcanzado el límite de {limit} clientes del plan gratuito...",
    "employees": "Has alcanzado el límite de {limit} {limit, plural, one {empleado} other {empleados}} del plan {plan}...",
    "appointments": "Alcanzaste el límite de {limit} citas/mes del plan gratuito..."
  }
}
```

Los mensajes de `limitErrors` usan formato ICU con plurales y selects para cada idioma.

### Namespace `clients.limitBadge`

```json
"limitBadge": "{current}/{limit} clientes"  // es
"limitBadge": "{current}/{limit} clients"   // en
```

---

## 14. Variables de Entorno

```bash
# ── PAYMENTS (NOWPayments) ─────────────────────────────────────────────────
NOWPAYMENTS_API_KEY=your-nowpayments-api-key
# Obtenida en: https://nowpayments.io → API → API Keys

NOWPAYMENTS_IPN_SECRET=your-nowpayments-ipn-secret
# Obtenida en: https://nowpayments.io → API → IPN Secret
# Usada para verificar la firma HMAC-SHA512 de los webhooks

NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
# Para pruebas: https://api.sandbox.nowpayments.io/v1

# ── QUEUE / SCHEDULING (Upstash QStash) ───────────────────────────────────
QSTASH_TOKEN=your-qstash-token
QSTASH_CURRENT_SIGNING_KEY=your-signing-key
QSTASH_NEXT_SIGNING_KEY=your-next-signing-key
# Obtenidas en: https://console.upstash.com → QStash

# ── SITE CONFIG ────────────────────────────────────────────────────────────
APP_URL=https://tudominio.com
# Usado en: success_url y cancel_url del invoice, y en la URL del worker de QStash

# ── SUPABASE (service role para saas_invoices) ─────────────────────────────
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# Requerido para insertar/actualizar saas_invoices y businesses (bypassa RLS)
```

---

## 15. Tests Unitarios

**Archivo**: `lib/payments/nowpayments.test.ts` (Vitest)

Cubre:

| Test | Descripción |
|------|-------------|
| `createInvoice` — éxito | Verifica que retorna `invoice_url` e `invoice_id` correctos |
| `createInvoice` — error API | Verifica que retorna `{ error: 'Invalid API Key' }` |
| `createInvoice` — error de red | Verifica el mensaje de error de red |
| `verifyIpnSignature` — sin firma | Retorna `false` |
| `verifyIpnSignature` — firma válida | Genera HMAC manualmente y verifica que pasa |
| `verifyIpnSignature` — firma inválida | Retorna `false` con string falso |

```bash
npx vitest run lib/payments/nowpayments.test.ts
```

---

## 16. Seguridad

### Webhook autenticado por HMAC

El endpoint `/api/webhooks/nowpayments` verifica la firma en el header `x-nowpayments-sig` antes de procesar o encolar. Un payload sin firma válida recibe `401`.

### Worker protegido por QStash

`/api/queue/process-saas-payment` usa `verifySignatureAppRouter` — cualquier request que no venga de QStash recibe `401`. Esto impide que actores maliciosos activen planes directamente.

### Cron protegido por QStash

`/api/cron/check-subscriptions` también usa `verifySignatureAppRouter`. Solo el CRON programado en QStash puede llamarla.

### RLS en saas_invoices

Los usuarios autenticados solo pueden leer sus propias facturas. No tienen permiso de INSERT ni UPDATE — solo el service role (webhooks, server actions con `createAdminClient`) puede escribir.

### business_id no viene del cliente

En `createSaaSCheckoutSession`, el `business_id` se obtiene de la sesión del usuario autenticado (`supabase.auth.getUser()`), no de parámetros del cliente. Esto previene que un usuario pague por el plan de otro negocio.

---

## 17. Migraciones de Base de Datos

### `20260430120000_saas_invoices.sql`

- Crea el enum `saas_invoice_status`.
- Crea la tabla `saas_invoices` con todos sus índices, políticas RLS y trigger de `updated_at`.
- Añade la columna `subscription_ends_at` a `businesses`.

### `20260504100000_referral_system.sql`

Agrega el sistema de referidos a la tabla `businesses`:

```sql
-- Columnas nuevas
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS referral_code           TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_id          UUID REFERENCES public.businesses(id),
  ADD COLUMN IF NOT EXISTS bonus_appointments_limit INTEGER DEFAULT 0;

-- Índice parcial para el query de "negocios que yo referí"
-- (WHERE referred_by_id = $1 — usado en la página Plan & Recompensas)
CREATE INDEX IF NOT EXISTS idx_businesses_referred_by_id
  ON public.businesses (referred_by_id)
  WHERE referred_by_id IS NOT NULL;

-- Poblar códigos para negocios existentes
UPDATE public.businesses
SET referral_code = substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8)
WHERE referral_code IS NULL;

-- Reemplaza fn_create_business_and_link_owner para aceptar p_referral_code
CREATE OR REPLACE FUNCTION public.fn_create_business_and_link_owner(..., p_referral_code TEXT DEFAULT NULL)
```

> La función `fn_create_business_and_link_owner` es `SECURITY DEFINER` — el `service_role` la ejecuta, no el cliente. Aplica el bonus de bienvenida (+10 citas) al negocio invitado y el bonus Dropbox al referidor en el momento del registro.

### `20260430130000_reset_plans_to_free.sql`

Migration de corrección de datos. Resetea a `'free'` todos los negocios que fueron asignados a `'pro'` durante el registro (bug anterior) y que no tienen ninguna factura `finished`:

```sql
UPDATE public.businesses
SET plan = 'free', subscription_ends_at = NULL, updated_at = NOW()
WHERE plan != 'free'
  AND id NOT IN (
    SELECT business_id FROM public.saas_invoices WHERE status = 'finished'
  );
```

---

## 18. Sistema de Referidos

### 18.1 Visión General

El sistema de referidos implementa **dos modelos de recompensa** simultáneos según el plan del referidor:

| Modelo | Plan referidor | Trigger | Recompensa |
|--------|---------------|---------|------------|
| **Dropbox** | Free | Registro del invitado | +10 citas/mes al referidor (cap: +50). El invitado recibe +10 de bienvenida. |
| **Notion** | Pro / Enterprise | Primer pago del invitado | +30 días de suscripción al referidor |

Ambos modelos coexisten. Un negocio free con 3 referidos tiene efectivamente `30 + 30 = 60` citas/mes.

**Flujo de registro con código referido**:
```
Usuario nuevo abre /register?ref=ABC12345
    → fn_create_business_and_link_owner(p_referral_code='ABC12345')
        → Busca negocio con referral_code='ABC12345'
        → Si referidor es Free → bonus_appointments_limit += 10 (referidor)
        → Inserta nuevo business con referred_by_id = referidor.id
        → Si invitado empieza en Free → bonus_appointments_limit = 10 (bienvenida)
```

**Flujo de primer pago del invitado**:
```
Invitado hace su primer pago (status='finished' en saas_invoices)
    → applyReferralBonus(businessId) en /api/queue/process-saas-payment
        → Verifica referred_by_id != NULL
        → Verifica que es el PRIMER pago (count=1 en saas_invoices finished)
        → Si referidor tiene plan pagado → subscription_ends_at += 30 días
        → Notificación in-app al referidor
```

---

### 18.2 Esquema de Base de Datos

#### Columnas en `businesses`

| Columna | Tipo | Default | Descripción |
|---|---|---|---|
| `referral_code` | TEXT UNIQUE | NULL → poblado en creación | Código único del negocio para compartir |
| `referred_by_id` | UUID FK → businesses(id) | NULL | ID del negocio que los refirió |
| `bonus_appointments_limit` | INTEGER | 0 | Citas extra acumuladas por referidos (solo relevante en plan free) |

#### Índices

```sql
-- referral_code ya tiene índice implícito por UNIQUE
-- referred_by_id necesita índice explícito (usado en WHERE referred_by_id = $1)
CREATE INDEX idx_businesses_referred_by_id
  ON public.businesses (referred_by_id)
  WHERE referred_by_id IS NOT NULL;
```

---

### 18.3 Tipos TypeScript

**Archivo**: `types/index.ts`

```typescript
// Derivados del schema — si la DB cambia, TypeScript fuerza actualizar los consumidores
export type ReferralBusiness = Pick<
  Business,
  'id' | 'name' | 'plan' | 'referral_code' | 'bonus_appointments_limit' | 'subscription_ends_at'
>

export type ReferralInvite = Pick<Business, 'id' | 'name' | 'plan' | 'created_at'>
```

> **Por qué `Pick` y no interfaces locales**: garantiza que `ReferralBusiness.plan` siempre sea `BusinessPlan | null` (el enum de la DB), nunca un `string` suelto que rompa la lógica de comparación.

---

### 18.4 Lógica de Recompensas — `lib/referrals/rewards.ts`

Función pura sin efectos secundarios ni dependencias de UI. Testeable de forma aislada.

```typescript
export interface ReferralRewardInfo {
  isFree:             boolean  // true si plan === 'free'
  currentBonus:       number   // bonus_appointments_limit actual
  baseLimit:          number   // PLAN_LIMITS.free.appointmentsPerMonth (30)
  maxBonus:           number   // MAX_BONUS_APPOINTMENTS (50)
  progressPercentage: number   // 0-100 para la barra de progreso
}

export function getReferralRewardInfo(
  plan: string | null,
  bonusLimit: number | null,
): ReferralRewardInfo
```

**Ejemplo**:
```typescript
getReferralRewardInfo('free', 20)
// → { isFree: true, currentBonus: 20, baseLimit: 30, maxBonus: 50, progressPercentage: 40 }

getReferralRewardInfo('pro', 0)
// → { isFree: false, currentBonus: 0, baseLimit: 30, maxBonus: 50, progressPercentage: 100 }
```

---

### 18.5 Función de Registro — `fn_create_business_and_link_owner`

**Archivo**: `supabase/migrations/20260504100000_referral_system.sql`

Función PostgreSQL `SECURITY DEFINER` que maneja todo el alta del negocio de forma atómica:

```sql
CREATE OR REPLACE FUNCTION public.fn_create_business_and_link_owner(
  p_owner_id      UUID,
  p_owner_name    TEXT,
  p_owner_email   TEXT,
  p_name          TEXT,
  p_category      TEXT,
  p_timezone      TEXT,
  p_plan          TEXT,
  p_referral_code TEXT DEFAULT NULL   -- ← nuevo parámetro
) RETURNS JSONB
```

**Orden de operaciones**:
1. Valida que `auth.uid() = p_owner_id` (no se puede crear negocio en nombre de otro).
2. Genera `slug` y `referral_code` propios del negocio nuevo.
3. Si `p_referral_code` fue proporcionado → busca el referidor.
4. Si referidor existe y es `free` → `bonus_appointments_limit += 10` (Dropbox bonus, cap 50).
5. Inserta el negocio con `referral_code` propio y `referred_by_id` del referidor.
6. Actualiza `users` para vincular al owner.
7. Si el invitado empieza en `free` y tiene referidor → `bonus_appointments_limit = 10` (bienvenida).

---

### 18.6 UI — `ReferralClient`

**Archivo**: `app/[locale]/dashboard/referrals/referral-client.tsx`
**Usado en**: `app/[locale]/dashboard/plans/page.tsx`

Componente `'use client'` completamente internacionalizado vía `useTranslations("referrals")`.

**Props**:
```typescript
interface ReferralClientProps {
  business: ReferralBusiness  // datos del negocio actual
  invited:  ReferralInvite[]  // negocios que usaron el código
  appUrl:   string            // NEXT_PUBLIC_APP_URL (pasado desde server)
}
```

**Secciones internas**:

| Sección | Descripción |
|---|---|
| Hero Card | Link para copiar + descripción del modelo de recompensa (dinámico según plan) |
| Estado de Recompensas | Barra de progreso (free) o contador de meses ganados (paid) |
| ¿Cómo funciona? | 3 pasos fijos, traducidos |
| Tus Referidos | Tabla con nombre, fecha y estado (Free / Plan Activo) |

**Clipboard seguro**:
```typescript
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch {
    // Silencioso: HTTP context o permisos denegados
  }
}
```

---

### 18.7 Internacionalización

Namespace `referrals` en `messages/{es,en}.json`. Todas las cadenas del componente usan `useTranslations("referrals")`.

**Claves principales**:

```json
"referrals": {
  "heroBannerFree":    "Gana +10 citas gratis por amigo",
  "heroBannerPaid":    "Gana 1 Mes Gratis de Plan Pro",
  "heroDescFree":      "...",
  "heroDescPaid":      "...",
  "copyLink":          "Copiar Enlace",
  "copied":            "¡Copiado!",
  "rewardStatusTitle": "Estado de Recompensas",
  "extraApptsLabel":   "Citas Extra Ganadas",
  "baseLimitText":     "Límite base: {base} citas. Actual: {current} citas/mes.",
  "monthsEarnedLabel": "Meses Ganados Totales",
  "expiryText":        "Tu suscripción actual vence el: {date}",
  "referralsListTitle":"Tus Referidos ({count})",
  "statusFree":        "Registrado (Free)",
  "statusPaid":        "Plan Activo (Premium)"
}
```

Y en el namespace `plans` (página contenedora):

```json
"plans": {
  "pageTitle":             "Plan & Recompensas",
  "pageSubtitle":          "...",
  "planSectionTitle":      "Tu Plan Actual",
  "referralSectionTitle":  "Programa de Referidos"
}
```

---

## Diagrama de Archivos

```
lib/
├── payments/
│   ├── nowpayments.ts              # API client + HMAC verifier
│   └── nowpayments.test.ts         # Tests unitarios (Vitest)
├── plans/
│   └── plan-limits.ts              # FUENTE ÚNICA DE VERDAD: límites + constantes referidos
├── referrals/
│   └── rewards.ts                  # getReferralRewardInfo() — lógica pura, sin UI
└── actions/
    └── check-appointment-limit.ts  # Helper server action para citas (incluye bonus)

app/
├── api/
│   ├── webhooks/nowpayments/route.ts        # Recibe IPN, encola en QStash
│   ├── queue/process-saas-payment/route.ts  # Worker: actualiza DB + applyReferralBonus()
│   └── cron/check-subscriptions/route.ts   # Degrada planes expirados
└── [locale]/dashboard/
    ├── plans/
    │   └── page.tsx                # Página unificada Plan + Referidos (server component)
    ├── referrals/
    │   ├── page.tsx                # Redirect → /dashboard/plans
    │   └── referral-client.tsx     # UI de referidos (client component)
    └── settings/
        ├── plan-manager.tsx        # Modal UI + Realtime listener
        └── actions.ts              # createSaaSCheckoutSession

types/
├── index.ts                        # ReferralBusiness, ReferralInvite (Pick<Business, ...>)
└── database.types.ts               # referral_code, referred_by_id, bonus_appointments_limit

messages/
└── {es,en}.json                    # nav.plans, plans.*, referrals.*

supabase/migrations/
├── 20260430120000_saas_invoices.sql
├── 20260430130000_reset_plans_to_free.sql
└── 20260504100000_referral_system.sql      # columnas + índice + fn actualizada
```
