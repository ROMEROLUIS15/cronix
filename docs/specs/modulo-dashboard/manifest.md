# Manifiesto de Dominio: Dashboard UI

## 1. Propósito

El Dashboard es la interfaz web exclusiva para el **DUEÑO / STAFF del negocio** (no para clientes). Permite gestionar citas, clientes, servicios, finanzas, equipo, reportes y configuración del negocio desde un navegador o PWA.

El punto de entrada es `app/[locale]/dashboard/` con un layout protegido que verifica sesión y pertenencia a negocio antes de renderizar cualquier contenido.

## 2. Estructura de Rutas

Secciones del dashboard identificadas en sidebar (`components/layout/sidebar.tsx`) y rutas reales en `app/[locale]/dashboard/`:

| Ruta | Sección | En Sidebar |
|---|---|---|
| `/dashboard` | Agenda (home) | Sí |
| `/dashboard/appointments` | Citas (listado) | No (sub-ruta de agenda) |
| `/dashboard/appointments/new` | Nueva cita | No |
| `/dashboard/appointments/[id]/edit` | Editar cita | No |
| `/dashboard/clients` | Clientes | Sí |
| `/dashboard/clients/new` | Nuevo cliente | No |
| `/dashboard/clients/[id]` | Perfil de cliente | No |
| `/dashboard/clients/[id]/edit` | Editar cliente | No |
| `/dashboard/services` | Servicios | Sí |
| `/dashboard/team` | Equipo | Sí (ownerOnly) |
| `/dashboard/finances` | Finanzas | Sí |
| `/dashboard/finances/expense` | Gasto individual | No |
| `/dashboard/finances/expenses` | Gastos | No |
| `/dashboard/finances/new` | Nuevo movimiento | No |
| `/dashboard/finances/transactions` | Transacciones | No |
| `/dashboard/reports` | Reportes | Sí |
| `/dashboard/observability` | Observabilidad | Sí (ownerOnly) |
| `/dashboard/settings` | Ajustes | Sí |
| `/dashboard/plans` | Planes | Sí |
| `/dashboard/profile` | Perfil | Sí (inline) |
| `/dashboard/referrals` | Referidos | No |
| `/dashboard/setup` | Onboarding | No |
| `/dashboard/admin/pulse` | System Pulse | Sí (adminOnly) |
| `/dashboard/admin/users` | User Management | Sí (adminOnly) |
| `/dashboard/admin/payments` | Payments | Sí (adminOnly) |

> **Onboarding (`/dashboard/setup`) captura el horario.** El formulario de creación pide hora de apertura/cierre (default 09:00–18:00) + toggle de domingos; la action `createBusiness` lo persiste en `settings.workingHours` en el formato canónico (`{ mon: [open, close] | null, … }`, claves de 3 letras) que leen los agentes WhatsApp y voz. Así ningún negocio nace sin horario usable. El editor por-día completo vive en Configuración.

## 3. Reglas de Acceso

Toda la protección se implementa en `app/[locale]/dashboard/layout.tsx`:

1. **Sin sesión**: `getAuthUser()` retorna `null` → `redirect('/login')`. Nunca se muestran datos del dashboard.
2. **Con sesión pero sin `business_id`**: si el perfil no tiene `business_id` y no es `platform_admin` y no está en `/setup` → `redirect('/dashboard/setup')`. El usuario no puede ver datos de ningún negocio.
3. **Platform Admin**: bypass de la regla de `business_id`. Puede acceder a rutas `/dashboard/admin/*`.
4. **Role-based en sidebar**:
   - `ownerOnly` (team, observability): oculto para empleados
   - `adminOnly` (admin/pulse, admin/users, admin/payments): visible solo para `platform_admin`
   - Items sin restricción: visibles para todos los roles autenticados con negocio

## 4. Patrones Obligatorios de UI

Todo componente de lista/datos debe implementar tres estados:

| Estado | Comportamiento |
|---|---|
| **Loading** | Mostrar spinner/skeleton mientras se resuelve la data asíncrona |
| **Error** | Mostrar mensaje de error con opción de reintento cuando falla la fuente de datos |
| **Empty (lista vacía)** | Mostrar mensaje informativo y CTA cuando no hay registros, ej: "No hay citas para esta fecha" |

**No se debe asumir estado perfecto.** Todo componente debe manejar los tres casos explícitamente.

Ejemplo en `appointments/page.tsx`: el hook `useAppointmentsList()` expone `loading`, `filteredApts` (que puede ser array vacío), y la UI maneja `isExpired` y otras condiciones de borde.

## 5. Integración con el Voice Agent

El dashboard monta un **Floating Action Button (FAB)** de voz (`components/dashboard/voice-assistant-fab.tsx`) en el layout:

- **Endpoint**: llama a `supabase/functions/v1/voice-worker` directamente
- **Autenticación**: envía el JWT del usuario (`Authorization: Bearer <access_token>`)
- **Input**: audio vía Web Speech API (desktop Chrome/Edge) o MediaRecorder + STT server-side del `voice-worker` (Deepgram Nova-2) en mobile/fallback; o texto si falla STT
- **Response**: recibe `{ text, audioUrl, actionPerformed, transcription }`
- **Invalidación post-acción**: si `actionPerformed=true`, invalida las queries de React Query para `appointments`, `dashboard-stats`, `clients` y `notifications`
- **Persistencia de historial**: guarda los últimos 15 turnos en `sessionStorage`
- **Visibilidad**: controlable por `business.settings.uiSettings.showLuisFab` en DB o por evento `cronix:toggle-fab`
- **Hard timeout**: 45s en estados `processing`/`speaking`, 30s en reproducción de audio

## 6. Criterios de Aceptación

### AC-1 — Usuario sin sesión → redirect a /login
- DADO un usuario no autenticado que intenta acceder a cualquier ruta `/dashboard/*`,
- CUANDO `getAuthUser()` retorna `null`,
- ENTONCES el layout ejecuta `redirect('/login')` y el navegador nunca renderiza datos del dashboard.

### AC-2 — Usuario con sesión pero sin `business_id` → no puede ver datos de negocio
- DADO un usuario autenticado cuyo perfil no tiene `business_id` y no es `platform_admin`,
- CUANDO intenta acceder a `/dashboard` (o cualquier ruta que no sea `/setup`),
- ENTONCES el layout ejecuta `redirect('/dashboard/setup')`. Los componentes de datos (page.tsx) reciben `initialStats` e `initialHasServices` con valores por defecto (cero/false).

### AC-3 — Todo componente de lista tiene estados loading, error y lista vacía
- DADO cualquier sección del dashboard que renderiza una lista (citas, clientes, servicios, etc.),
- CUANDO el componente se monta o recibe datos,
- ENTONCES debe manejar explícitamente:
  - **Loading**: indicador visual mientras se resuelve la data
  - **Empty**: mensaje informativo cuando la lista está vacía
  - **Error**: mensaje de error con opción de reintento cuando falla la fuente de datos

## 7. Internacionalización (i18n) — NORMATIVO

El dashboard es multi-idioma vía `next-intl`. Locales: `es` (fuente/default), `en`, `pt`, `fr`, `de`, `it` (única fuente de verdad: `i18n/routing.ts`). Los mensajes viven en `messages/<locale>.json` (CRLF + 2 espacios).

Reglas (innegociables):

1. **Cero texto hardcoded visible al usuario.** Todo string que ve el dueño/staff (JSX, `title`, `aria-label`, `placeholder`, `alt` no-marca) DEBE resolverse vía `t()` / `t.rich()` / `getTranslations()`. Excepciones permitidas y documentadas: nombres de marca (`Cronix`, `WhatsApp Business`, `Binance Pay ID`, `Pago Móvil`), nombres de plan (`Free`/`Pro`/`Enterprise`), y herramientas internas solo-`platform_admin` (`/dashboard/admin/*`, `components/admin/*`) que se mantienen en inglés a propósito.
2. **Server components** usan `getTranslations`/`getLocale` (async, `next-intl/server`); **client components** usan `useTranslations` (`next-intl`). El `t` debe declararse en el MISMO componente donde se renderiza (cuidado con sub-componentes y fallbacks de `<Suspense>`).
3. **Formato locale-aware.** `toLocaleString`/fechas usan el locale activo (`getLocale()`), nunca un locale fijo (`'es-CO'`).
4. **Paridad de claves obligatoria.** Cada locale expone EXACTAMENTE el mismo set de claves que `es`. Garantizado por `__tests__/i18n/parity.test.ts` (falla en CI ante claves faltantes/sobrantes). Una clave faltante = pantalla en idioma equivocado.
5. **Sin errores ortográficos** en ningún idioma (revisión nativa por locale).

> Estado: dashboard + auth/público + componentes UI/PWA + páginas legales (`privacy`, `terms`) migrados y verificados (`tsc` limpio, parity test verde, 44 namespaces ×6 locales). Toda la superficie de cara al usuario está internacionalizada; lo único hardcoded restante es marca (`Cronix`, `Free`/`Pro`/`Enterprise`), herramientas internas `platform_admin` (inglés a propósito) y la herramienta de debug `pwa-debug`. Las traducciones legales (privacy/terms) son boilerplate SaaS y conviene una revisión legal por jurisdicción. Revisión nativa de calidad por idioma COMPLETADA (DE→registro `du` unificado; FR→meses Juin/Juil; IT→concordancia de género; PT/EN limpios). Único polish opcional restante: consistencia cosmética `email`/`e-mail` (todos los locales).

## 8. Métricas financieras — fuente canónica (NORMATIVO)

Home, Finanzas y Reportes muestran cifras del mes. **Las tres consumen UNA sola fuente de verdad: el RPC `fn_get_monthly_metrics(p_business_id, p_month_start date)`** (migración `20260622000000`). Está prohibido recalcular ingresos del mes con una fórmula propia en cualquier sección — eso reintroduce la divergencia que este contrato elimina.

El RPC deriva el mes calendario completo a partir de `p_month_start` y devuelve, **atribuyendo por la fecha de la cita (`start_at`)**:

| Campo | Significado | Base |
|---|---|---|
| `billed_revenue` | **Prestado** — valor de servicios prestados | `SUM(services.price)` de citas `completed` con `start_at` en el mes |
| `collected_revenue` | **Cobrado** — caja real | `SUM(transactions.net_amount)`; se atribuye por el `start_at` de la cita vinculada. **Una transacción sin cita** (`appointment_id` nulo: pago manual/walk-in) se atribuye por su `paid_at`, porque no tiene `start_at`. |
| `total_expenses` | **Gastos** | `SUM(expenses.amount)` con `expense_date` (columna `date`) dentro del mes, comparado como `date` (incluye día 1 y último día). |

Reglas normativas:

1. **Dos métricas separadas, nunca mezcladas.** Prestado (`billed`) y Cobrado (`collected`) son universos distintos y **no tienen por qué cuadrar entre sí** (una cita completada puede no estar pagada; un pago puede llevar descuento/propina). La utilidad y los ratios (`marginPct`, `expensePct`) se calculan sobre **Cobrado**; `collectionRate = collected/billed`. La derivación vive en la función pura `buildMonthlyFinanceView` (`lib/use-cases/finances.use-case.ts`).
2. **El desglose "por servicio" de Reportes es base Prestado** (precio de lista de citas completed) — la misma base que `billed`, para que reconcilien.
3. **`fn_get_dashboard_stats.month_revenue` = `collected`** (mismo RPC). El Home muestra caja real.
4. **Cotas correctas:** rango half-open `[inicio_mes, inicio_mes_siguiente)`; jamás filtrar "del 1 en adelante" sin cota superior (bug histórico), ni comparar `date` contra timestamp ISO como string (descartaba el gasto del día 1).
5. Acceso solo vía repo: `finances.getMonthlyMetrics(businessId, monthStart)` (`IFinanceRepository`), que coacciona los `NUMERIC` (strings de PostgREST) a number.
6. **Aislamiento multi-tenant (constitution §4) — OBLIGATORIO.** `fn_get_monthly_metrics` y `fn_get_dashboard_stats` son `SECURITY DEFINER` (bypasean RLS) y ejecutables por `authenticated`. Por eso DEBEN llamar al guard `fn_assert_business_access(p_business_id)` como primera sentencia: solo pasan `service_role`, el dueño del negocio (`current_business_id()`) o un `platform_admin`; cualquier otro → `42501`. Sin el guard, un usuario podía leer las finanzas de otro negocio enumerando UUIDs (fuga cerrada en `20260622120000`, cubierta por pgTAP en `rls_policies.test.sql §27`). Toda nueva RPC `SECURITY DEFINER` que reciba `business_id` y sea ejecutable por `authenticated` debe usar este mismo guard.
