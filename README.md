# Cronix — Plataforma SaaS de Gestión de Citas y Negocios

> Plataforma multi-tenant para negocios de servicios en Latinoamérica. Gestión de citas, clientes, equipo, finanzas y recordatorios automáticos por WhatsApp — todo en una sola aplicación PWA optimizada para móvil.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 14 (App Router, Server Components, Server Actions) |
| Lenguaje | TypeScript 5 — tipado estricto en todo el proyecto |
| Base de datos | PostgreSQL via Supabase (RLS, ENUMs, indexes optimizados) |
| Autenticación | Supabase Auth + WebAuthn/Passkeys (biometría) + Google OAuth |
| Data Access | Supabase JS SDK con repositorios tipados |
| Cache / Data Fetching | React Query v5 (`@tanstack/react-query`) con cache global |
| Estilos | Tailwind CSS + CVA (class-variance-authority) |
| Validación | Zod (schemas compartidos en cliente y servidor) |
| Formularios | React Hook Form + Zod resolvers |
| Fechas | date-fns v4 |
| Iconos | Lucide React |
| Testing unitario | Vitest + jsdom |
| Testing de BD | pgTAP (tests de RLS contra Postgres real) |
| Notificaciones | WhatsApp Cloud API v19.0 (Meta) — plantilla aprobada |
| PWA | next-pwa — instalable en iOS, Android y desktop |
| Imágenes | Sharp (generación de assets PWA, optimización) |
| Deploy | Vercel (auto-deploy desde `main`) |
| CI/CD | GitHub Actions (cron de recordatorios cada 15 min) |

---

## Arquitectura

```
cronix/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes (Edge/Node)
│   │   ├── passkey/              # WebAuthn register + authenticate
│   │   ├── cron/send-reminders/  # Cron job WhatsApp
│   │   └── activity/ping/        # Heartbeat de sesión
│   ├── auth/callback/            # OAuth callback (Google) + identity linking
│   ├── dashboard/                # Páginas protegidas (layout + subpáginas)
│   │   ├── appointments/         # CRUD citas + resolución de expiradas
│   │   ├── clients/              # CRUD clientes + historial + deudas
│   │   ├── finances/             # Transacciones y gastos
│   │   ├── services/             # Servicios del negocio
│   │   ├── team/                 # Gestión de empleados
│   │   ├── reports/              # Reportes y analítica
│   │   ├── profile/              # Perfil + passkeys
│   │   ├── settings/             # Configuración
│   │   └── setup/                # Wizard de onboarding
│   ├── login/                    # Login con email, Google, Passkeys
│   ├── register/                 # Registro de cuenta
│   ├── forgot-password/          # Recuperación de contraseña
│   └── reset-password/           # Reset de contraseña
├── components/
│   ├── ui/                       # Primitivos reutilizables (Modal, Card, Avatar, etc.)
│   ├── layout/                   # Sidebar, Topbar, DashboardShell, BottomNav
│   ├── dashboard/                # Componentes específicos del dashboard
│   └── providers.tsx             # QueryClientProvider (React Query)
├── lib/
│   ├── supabase/                 # Clientes (browser, server, admin, middleware)
│   ├── repositories/             # Capa de acceso a datos (por tabla)
│   ├── use-cases/                # Lógica de negocio (validaciones, reglas)
│   ├── services/                 # Servicios externos (WhatsApp)
│   ├── validations/              # Schemas Zod
│   ├── hooks/                    # React hooks (useBusinessContext, useFetch, usePwaInstall)
│   └── utils.ts                  # Utilidades generales
├── types/                        # Tipos TypeScript globales + tipos generados de BD
├── supabase/
│   ├── migrations/               # SQL migrations versionadas
│   └── tests/                    # Tests pgTAP de RLS (26 tests)
├── public/
│   ├── manifest.json             # PWA manifest con splash screens
│   ├── sw.js                     # Service Worker
│   ├── icon-192x192.png          # PWA icon (generado con Sharp)
│   └── icon-512x512.png          # PWA icon (generado con Sharp)
└── .github/workflows/            # GitHub Actions (cron de recordatorios)
```

---

## Funcionalidades

### Autenticación y Seguridad

- **Login con email/contraseña** y **OAuth con Google**
- **Passkeys / biometría** — WebAuthn con `@simplewebauthn` v13. Huella dactilar y Face ID en móvil y desktop sin contraseña
- **Identity linking** — si un usuario se registra con email y después entra con Google (o viceversa), las cuentas se fusionan automáticamente. Nunca se crean cuentas duplicadas gracias a:
  1. **Supabase:** `enable_manual_linking = true` fusiona auth users con mismo email
  2. **Aplicación:** `register/actions.ts` verifica email existente con admin client antes de crear usuario
  3. **Base de datos:** `UNIQUE(email)` constraint en tabla `users`
- **Callback inteligente** — `ensureUserProfile()` busca por auth ID → por email → crea nuevo, garantizando fusión de identidades
- **Confirmación de email** activada — usuarios verifican email antes de acceder
- **Timeout de sesión** — inactividad de 30 min + límite absoluto de 12h, enforceado en middleware
- **Protección de rutas** en Next.js middleware con fast-path: si no hay cookies `sb-` se omite el round-trip a Supabase Auth
- **Status check cacheado** — el estado del usuario (`active`/`rejected`) se cachea en cookie por 5 minutos, eliminando queries a BD en cada navegación del dashboard
- Usuarios bloqueados (`status: rejected`) son deslogueados automáticamente
- **RLS en passkey_challenges** — tabla protegida, solo el usuario ve sus propios challenges

### Gestión de Citas

- Crear, editar y cancelar citas con selección de servicio, cliente y empleado asignado
- **Calendario mensual interactivo** con vista de citas por día
- **Validación de doble reserva** configurable por negocio: `allowed` / `warn` / `blocked`
- **Resolución de citas expiradas** — botones "Sí, fue atendido" / "No se presentó" con wrapping responsive
- **Recordatorios automáticos por WhatsApp** — al crear o editar una cita se programa un recordatorio con plantilla `appointment_reminder` de Meta (4 variables: nombre cliente, nombre negocio, fecha, hora)
- Estados: `pending`, `confirmed`, `completed`, `cancelled`, `no_show`

### Recordatorios WhatsApp

- Tabla `appointment_reminders` con estados `pending → sent / failed / cancelled`
- Cron job cada 15 minutos via **GitHub Actions** (Vercel Hobby solo permite 1 cron diario)
- API endpoint `GET /api/cron/send-reminders` protegido con `CRON_SECRET` bearer token
- Integración con **WhatsApp Cloud API v19.0** de Meta
- **Token permanente** (System User Token de Meta Business Manager, no expira)
- Template con 4 variables: `{{1}}` cliente, `{{2}}` negocio, `{{3}}` fecha, `{{4}}` hora
- Reintentos implícitos: si falla, el registro queda en `failed` con el mensaje de error

### Gestión de Clientes

- CRUD completo con datos de contacto, notas, tags y foto de avatar
- Historial de citas por cliente
- Gestión de deudas (dialog `DebtActionDialog`)

### Equipo / Empleados

- Los dueños (`owner`) pueden crear, editar, activar/desactivar y eliminar empleados
- Protegido con `assertOwner()` en server actions — solo el dueño puede gestionar el equipo
- Las operaciones usan `createAdminClient()` (service role) para bypassar RLS, con validación de autorización explícita en capa de servidor
- Protección anti-eliminación: no se puede borrar un empleado con citas asignadas

### Finanzas

- Registro de transacciones e ingresos
- Registro de gastos por categorías (`supplies`, `rent`, `utilities`, `payroll`, `marketing`, `equipment`, `other`)
- Múltiples métodos de pago: efectivo, tarjeta, transferencia, QR, otros
- Grid responsive: 2 columnas en tablets+

### Servicios

- CRUD de servicios del negocio con duración y precio
- Banner de onboarding que desaparece permanentemente al crear el primer servicio

### Reportes

- Analítica de citas, ingresos y ocupación

### PWA — Progressive Web App

- Instalable en iOS, Android, Windows y macOS
- Service Worker con caché offline
- **Splash screen** personalizado: fondo azul `#0066FF` + cuadro oscuro redondeado + logo centrado
- Captura de `beforeinstallprompt` en inline script (antes de que React hidrate)
- Banner de instalación en landing y login
- Botón flotante de instalación dentro del dashboard
- Assets generados con Sharp: `icon-192x192.png`, `icon-512x512.png`, splash screens

### Perfil

- Editar nombre, teléfono y avatar
- Registrar y eliminar passkeys (dispositivos biométricos)
- Avatar con upload y fallback a iniciales con color

---

## Responsive Design

La plataforma está auditada y optimizada para todos los dispositivos:

### Breakpoints

| Breakpoint | Ancho | Uso |
|------------|-------|-----|
| Base | < 480px | iPhone SE, Android compacto |
| `xs` | 480px | Transición mobile-tablet |
| `sm` | 640px | Landscape, tablets pequeñas |
| `md` | 768px | iPad mini, tablets |
| `lg` | 1024px | iPad Pro, desktop |
| `xl` | 1280px | Desktop grande |

### Touch Targets (WCAG 2.5)

- Botones de navegación: `py-3` (44px+) en mobile y desktop
- Botón de cerrar sidebar: `p-2.5` con icono de 20px = 50px touch area
- Botón de cerrar sesión: `py-3` + `text-sm` = 44px+
- Toggle de contraseña: `p-2` con aria-label descriptivo
- Botón cerrar modal: `p-2` = 42px+ touch area

### Layout Adaptativo

- **Sidebar:** overlay con slide en mobile (`< 1024px`), fija en desktop (`lg+`)
- **Scroll lock:** CSS `touch-action: none` + `overscroll-behavior: none` en mobile cuando sidebar abierta
- **Modales:** bottom-sheet en mobile (slide-from-bottom, `rounded-t-3xl`), centrado en desktop
- **Modal max-height:** `90dvh` en mobile, `85vh` en desktop con flex-col para scroll interno
- **Modal footer:** padding extra en mobile (`pb-6`) para clearance de nav bar Android
- **Formularios:** grid `grid-cols-1 xs:grid-cols-2` (stack en < 480px, 2 columnas en > 480px)
- **Bottom padding:** `4rem (64px)` en mobile para nav bars Android, `1.5rem` en `sm+`

### Viewport & Safe Areas

- `viewport-fit:cover` **no** habilitado intencionalmente — evita que `env(safe-area-inset-top)` desplace el shell
- `100dvh` con fallback a `100vh` para altura dinámica del viewport
- `overflow-x: hidden` en `html`, `body` y main content para prevenir scroll horizontal

---

## Optimización de Rendimiento

### Font Loading
- **next/font/google** — `Inter` cargada con `display: 'swap'`, sin `@import url()` bloqueante
- Pesos: 400, 500, 600, 700, 800, 900

### Image Optimization
- **Next.js Image** con optimización habilitada en todas las imágenes (sin `unoptimized`)
- Generación automática de WebP/AVIF por Next.js
- Atributo `sizes` configurado por componente para servir resolución óptima
- Imágenes con dimensiones fijas: `sizes="48px"`, `sizes="96px"`, etc.
- Imágenes responsive: `sizes="(min-width: 640px) 260px, 180px"`

### Data Caching (React Query)
- **QueryClientProvider** envuelve el dashboard layout
- `staleTime: 5min` por defecto — datos se reusan entre navegaciones sin re-fetch
- `gcTime: 10min` — cache en memoria por 10 minutos
- `refetchOnWindowFocus: false` — sin refetches sorpresa al cambiar de pestaña
- **useBusinessContext** — contexto de auth/business cacheado 10 min. Navegar entre 8+ páginas reutiliza el mismo resultado
- **useFetch** — wrapper genérico sobre `useQuery` con API simplificada (`data`, `loading`, `error`, `refetch`)

### Middleware Caching
- **Status check cacheado** — cookie `cronix_user_status` con TTL de 5 minutos
- Primera navegación al dashboard → query a BD + cache del status
- Navegaciones subsiguientes (5 min) → lee cookie, skip query
- Si usuario es bloqueado → se detecta en máximo 5 minutos
- **Fast-path:** sin cookies `sb-*` → redirect sin round-trip a Supabase Auth

---

## Base de Datos

### Tablas

| Tabla | Descripción |
|-------|-------------|
| `users` | Usuarios con roles (`owner`, `employee`, `platform_admin`), `UNIQUE(email)` |
| `businesses` | Negocios/cuentas multi-tenant |
| `clients` | Clientes de cada negocio |
| `appointments` | Citas agendadas con servicio, cliente y empleado |
| `appointment_reminders` | Cola de recordatorios WhatsApp |
| `services` | Servicios ofrecidos por el negocio |
| `transactions` | Registros de pagos |
| `expenses` | Gastos del negocio |
| `user_passkeys` | Credenciales WebAuthn almacenadas |
| `passkey_challenges` | Challenges temporales para flujo passkey (RLS habilitado) |

### Row Level Security (RLS)

Todas las tablas tienen RLS habilitado. El aislamiento de datos se garantiza a nivel de base de datos:

- Cada usuario solo ve y modifica datos de su propio negocio (`business_id`)
- `anon` no puede hacer ninguna mutación
- El `service_role` (usado en server actions) bypassa RLS de forma controlada
- Los tests pgTAP verifican esto contra Postgres real — no mocks
- `passkey_challenges` protegida con política `challenges_own_user`

### Índices Optimizados

Estrategia de indexación aplicada: un índice compuesto `(a, b)` cubre queries que filtran solo por `a`, haciendo redundante un índice simple `(a)`.

**Índices activos:**

| Índice | Columnas | Query que optimiza |
|--------|----------|-------------------|
| `idx_appointments_business_date` | `(business_id, start_at)` | Calendario, listados por fecha |
| `idx_appointments_client_id` | `(client_id)` | Historial de citas por cliente |
| `idx_appointments_assigned_user` | `(assigned_user_id)` | Queries de equipo |
| `idx_clients_business` | `(business_id) WHERE active` | Listado de clientes activos |
| `idx_expenses_business_date` | `(business_id, date)` | Reportes financieros |
| `idx_services_business_active` | `(business_id) WHERE active` | Selector de servicios |
| `idx_transactions_business_date` | `(business_id, created_at)` | Reportes financieros |
| `idx_transactions_appointment` | `(appointment_id)` | Lookup por cita |
| `idx_reminders_business` | `(business_id)` | Queries RLS |
| `idx_reminders_pending` | `(status, remind_at) WHERE status='pending'` | Cron de envío |
| `idx_passkeys_user` | `(user_id)` | Lookup de passkeys |

**8 índices duplicados eliminados** — reduces write overhead sin afectar reads.

### ENUMs

```sql
appointment_status: pending | confirmed | completed | cancelled | no_show
user_role:          owner | employee | platform_admin
user_status:        pending | active | rejected
business_plan:      free | pro | enterprise
auth_provider:      email | google | hybrid
payment_method:     cash | card | transfer | qr | other
expense_category:   supplies | rent | utilities | payroll | marketing | equipment | other
```

---

## Patrones de Arquitectura

### Repositorios + Use Cases

Separación en capas:
- **Repositorios** (`lib/repositories/`) — queries a Supabase, sin lógica de negocio
- **Use Cases** (`lib/use-cases/`) — reglas de negocio (validación de doble reserva, cálculos financieros)
- **Server Actions** (`app/**/actions.ts`) — punto de entrada desde el cliente, validación Zod + autorización

### Dos clientes Supabase

```typescript
createClient()       // RLS activo — para operaciones del usuario autenticado
createAdminClient()  // service_role — bypassa RLS, solo en server actions con assertOwner()
```

### Middleware optimizado

```typescript
// Fast path: si no hay cookies sb-*, skip del round-trip a Supabase Auth
if (!hasSessionCookies(request)) { ... }

// Status check cacheado en cookie (5 min TTL) — evita query a BD en cada navegación
const cachedStatus = request.cookies.get('cronix_user_status')?.value
if (!cachedStatus) {
  // Query DB + cache result
}

// Status check solo en navegaciones de página, no en API routes
const isDashboardPage = user && pathname.startsWith('/dashboard') && !pathname.startsWith('/api/')
```

### React Query Integration

```typescript
// Provider envuelve el dashboard layout
<Providers>
  <DashboardShell>
    {children}
  </DashboardShell>
</Providers>

// useBusinessContext — cacheado 10 min, compartido entre 8+ páginas
const { businessId, userId, supabase } = useBusinessContext()

// useFetch — wrapper genérico con cache automático
const { data, loading, refetch } = useFetch('clients', () => repo.getClients(supabase, businessId!), { enabled: !!businessId })
```

---

## Design System — Cronix Carbón Dark

### Tokens de Color

```css
--background:    240 5% 7%     /* #0F0F12 — gris carbón */
--foreground:    0 0% 95%      /* #F2F2F2 */
--surface:       240 4% 10%    /* #181818 */
--card:          240 4% 11%    /* #1A1A1F */
--border:        240 4% 16%    /* #272729 */
--muted:         240 4% 14%    /* #212125 */
--primary:       220 100% 50%  /* #0062FF */
```

### Accent Colors

- Azul: `#0062FF` (primary, CTAs, active states)
- Cyan: `#00D1FF` (informational)
- Verde: `#30D158` (success, completado)
- Amarillo: `#FFD60A` (warning, pendiente)
- Rojo: `#FF3B30` (danger, cancelado)

### Componentes CSS

- `card-base` — bordes con glow azul en hover
- `input-base` — focus ring azul con box-shadow
- `btn-primary`, `btn-secondary`, `btn-ghost` — con `active:scale-[0.97]`
- `nav-item`, `nav-item-active`, `nav-item-inactive` — con glow en active state
- `badge-blue`, `badge-green`, `badge-yellow`, `badge-red`, `badge-gray`
- `stat-card`, `stat-card-accent` — con gradient azul
- `bottom-sheet` — panel mobile con handle y `max-height: 90dvh`
- Animaciones: `fadeIn`, `slideUp`, `slideFromBottom`

---

## Testing

### Tests Unitarios (Vitest)

```bash
npm run test           # Ejecutar una vez
npm run test:watch     # Modo watch
npm run test:coverage  # Con reporte de cobertura
npm run test:ui        # UI interactiva
```

### Tests de RLS (pgTAP)

26 tests de integración reales contra Postgres local — no mocks:

```bash
supabase start --ignore-health-check
supabase test db
```

Verifican:
- RLS habilitado en todas las tablas críticas
- `anon` no puede hacer INSERT en `users` ni `businesses`
- Un usuario no puede insertar row con ID de otro usuario
- Owner A no ve datos de Owner B (businesses, appointments, clients, reminders)
- Owner B no puede insertar reminders en negocio de Owner A
- `service_role` bypassa RLS correctamente
- 5 políticas críticas verificadas por nombre

---

## Variables de Entorno

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# WhatsApp Cloud API (Meta)
WHATSAPP_ACCESS_TOKEN=       # System User Token (permanente)
WHATSAPP_PHONE_NUMBER_ID=

# Seguridad del cron
CRON_SECRET=
```

---

## CI/CD

### GitHub Actions — Cron de Recordatorios

`.github/workflows/cron-reminders.yml` — se ejecuta cada 15 minutos:

```yaml
schedule:
  - cron: '*/15 * * * *'
```

Llama `GET /api/cron/send-reminders` con el bearer token `CRON_SECRET`.

> Vercel Hobby plan limita a 1 cron/día. GitHub Actions no tiene esa limitación.

### Vercel

Deploy automático en push a `main`. El `vercel.json` mantiene un cron diario como fallback.

---

## Desarrollo Local

### Requisitos

- Node.js 18+
- Docker Desktop (para Supabase local)
- WSL2 (para Supabase CLI en Windows)

### Setup

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno
cp .env.local.example .env.local
# Completar con tus keys de Supabase y WhatsApp

# 3. Iniciar Supabase local (en WSL2)
export SUPABASE_ACCESS_TOKEN=<tu_token>
supabase start --ignore-health-check

# 4. Iniciar servidor de desarrollo
npm run dev
```

### Scripts

```bash
npm run dev          # Servidor de desarrollo con Turbopack
npm run build        # Build de producción
npm run start        # Servidor de producción
npm run lint         # ESLint
npm run typecheck    # Verificación TypeScript
npm run test         # Tests unitarios
npm run test:watch   # Tests en modo watch
npm run test:ui      # Tests con UI interactiva
npm run test:coverage # Tests con cobertura
supabase test db     # Tests de RLS (requiere supabase start)
```

---

## Despliegue

1. Conectar repositorio a Vercel
2. Configurar variables de entorno en Vercel Dashboard
3. Configurar secrets en GitHub (`APP_URL`, `CRON_SECRET`) para el cron de Actions
4. Push a `main` → deploy automático

---

## Seguridad — Resumen

| Capa | Protección |
|------|-----------|
| Base de datos | RLS en todas las tablas, aislamiento por `business_id` |
| Índices | `UNIQUE(email)` previene cuentas duplicadas |
| Auth | Email confirmado, identity linking automático, passkeys |
| Middleware | Fast-path sin cookies, status cacheado, session timeouts |
| Server Actions | `assertOwner()` + admin client con validación explícita |
| API | Bearer token `CRON_SECRET` en endpoints de cron |
| Frontend | Protección de rutas, scroll lock, touch-action control |

---

## Internacionalización

- Idioma: **Español**
- Locale: **es-CO** (Colombia)
- Moneda: **COP** (Peso Colombiano)
- Fechas y horas formateadas para Latinoamérica
- Plantilla WhatsApp en español aprobada por Meta

---

## Licencia

Ver archivo [LICENSE](LICENSE).
