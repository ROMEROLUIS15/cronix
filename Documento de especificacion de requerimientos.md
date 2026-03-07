<div align="center">

<img src="https://img.shields.io/badge/▶-AGENDO-EA580C?style=for-the-badge&labelColor=1C0A00&color=EA580C" alt="Agendo" height="42"/>

# Agendo

### *Tu negocio en control, tus clientes en orden.*

**Plataforma SaaS Multi-Tenant de Gestión de Citas para Negocios de Servicios**

---

[![Next.js](https://img.shields.io/badge/Next.js-14+-000000?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x_Strict-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_15-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-06B6D4?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![Zod](https://img.shields.io/badge/Zod-Validated-3068B7?style=for-the-badge)](https://zod.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-EA580C?style=for-the-badge)](LICENSE)
[![PRD](https://img.shields.io/badge/PRD-v1.0-EA580C?style=for-the-badge)](docs/PRD.md)

<br/>

**Gestiona citas, clientes y finanzas · Recordatorios automáticos por WhatsApp y Email**
**Arquitectura desacoplada · Seguridad extrema multi-tenant · Doble agenda por cliente**

<br/>

[Demo en Vivo](https://demo.agendo.app) &nbsp;·&nbsp; [Documentación](https://docs.agendo.app) &nbsp;·&nbsp; [Reportar Bug](issues) &nbsp;·&nbsp; [Solicitar Feature](issues)

</div>

---

## Tabla de Contenidos

- [Descripción General](#descripción-general)
- [Identidad de Marca y Paleta de Colores](#identidad-de-marca--paleta-de-colores)
- [Características Principales](#características-principales)
- [Doble Agenda — Función Estrella](#-doble-agenda--la-función-estrella-que-nos-diferencia)
- [Stack Tecnológico](#stack-tecnológico)
- [Arquitectura Database-Agnostic](#arquitectura-database-agnostic)
- [Validación y Tipado con Zod + TypeScript](#validación-y-tipado-robusto-zod--typescript)
- [Seguridad Multi-Tenant Extrema](#seguridad-multi-tenant-extrema)
- [Guía de Instalación](#guía-de-instalación)
- [Variables de Entorno](#variables-de-entorno)
- [Esquema de Base de Datos Completo](#esquema-de-base-de-datos-completo)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Roadmap](#roadmap)
- [Contribución](#contribución)
- [Licencia](#licencia)

---

## Descripción General

**Agendo** es una plataforma SaaS multi-tenant de gestión de citas diseñada específicamente para negocios de servicios en Latinoamérica y el mundo hispanohablante. Elimina la fricción operativa diaria: las agendas físicas, los grupos de WhatsApp caóticos y las hojas de cálculo improvisadas.

Con Agendo, cada propietario de negocio tiene su propio espacio completamente aislado para gestionar su agenda, clientes, ingresos y reportes — todo desde un panel moderno y accesible desde cualquier dispositivo.

### ¿Para quién es Agendo?

| Tipo de Negocio | Caso de Uso Principal |
|---|---|
| 💇 Estéticas y Salones | Agenda por tipo de servicio, recordatorios previos al tratamiento |
| ✂️ Barberías | Turnos rápidos con **doble agenda diaria** por cliente |
| 🔧 Talleres Mecánicos | Control de citas por vehículo e historial de servicios |
| 🩺 Consultorios Médicos | Historial básico, notas privadas y recordatorios de citas |
| 🧠 Psicólogos / Terapeutas | Sesiones recurrentes, privacidad garantizada por RLS |
| 💅 Centros de Estética | Multi-servicio en el mismo día (uñas + masaje + facial) |
| 💼 Cualquier negocio de servicios | Agenda + CRM + Finanzas + Reportes |

---

## Identidad de Marca & Paleta de Colores

### Filosofía de Diseño

**Personalidad visual: Energético y cercano.** Agendo está hecho para el dueño de la barbería, la estética y el consultorio — personas activas, prácticas y que no tienen tiempo que perder. La identidad visual refleja eso: sin frialdad corporativa, sin exceso de minimalismo frío. Energía real, interfaz directa.

El sistema de color se construye sobre **Naranja Fuego** (`#EA580C`) como primario — uno de los pocos colores que activa atención y acción sin generar ansiedad, y que es prácticamente territorio libre en el mercado de apps de agenda. Se complementa con un fondo muy oscuro en modo dark (`#150A00`) que crea un contraste dramático y premium, y con blanco cálido en modo claro (`#FFFBF7`) que evita la frialdad del blanco puro.

### Paleta Principal

```
 NARANJA FUEGO (Primario)       MODO CLARO                MODO OSCURO
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 brand-50   → #FFF7ED           bg-base:     #FFFBF7       bg-base:     #150A00
 brand-100  → #FFEDD5           bg-surface:  #FFF7ED       bg-surface:  #1C0D00
 brand-200  → #FED7AA           bg-card:     #FFFFFF       bg-card:     #241100
 brand-300  → #FDBA74           text-base:   #1C0A00       text-base:   #FFF7ED
 brand-400  → #FB923C           text-muted:  #78350F       text-muted:  #C2763D
 brand-500  → #F97316           border:      #FED7AA       border:      #3D1F00
 brand-600  → #EA580C  ◀ BASE   ring:        #EA580C       ring:        #EA580C
 brand-700  → #C2410C           shadow:      rgba(0,0,0,0.06)  shadow:  rgba(0,0,0,0.4)
 brand-800  → #9A3412
 brand-900  → #7C2D12           SEMÁNTICOS (universales — no cambian entre modos)
                                ──────────────────────────────────────────────────
 NEUTROS CÁLIDOS                success:     #22C55E       (verde natural)
 ━━━━━━━━━━━━━━━━━━━            warning:     #EAB308       (amarillo cálido)
 warm-50  → #FFFBF7             danger:      #EF4444       (rojo)
 warm-100 → #FEF3C7             info:        #3B82F6       (azul)
 warm-900 → #1C0A00             pending:     #F97316       (naranja medio)
                                confirmed:   #22C55E
                                completed:   #6B7280
                                cancelled:   #EF4444
                                dual:        #EA580C  ← ⭐ Doble agenda (naranja brand)
```

### Por qué este naranja y no el amarillo

El amarillo `#FFFF00` comunica precaución y construcción (señales de tráfico, cintas de peligro). El naranja `#EA580C` comunica energía positiva, acción y cercanía — es el color de las notificaciones de WhatsApp, del call-to-action de Amazon, y de la mayoría de apps de delivery que quieren sentirse urgentes pero amigables. Para Agendo, que vive de la acción rápida (agendar, confirmar, recordar), ese mensaje es perfecto.

### Configuración en `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class', // Controlado por next-themes — sin FOUC
  theme: {
    extend: {
      colors: {
        // ── Naranja Fuego (marca principal) ───────────────────
        brand: {
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C', // ← primary: botones, links, iconos activos
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
        },
        // ── Neutros cálidos (fondos y textos) ─────────────────
        warm: {
          50:  '#FFFBF7',
          100: '#FEF3C7',
          200: '#FDE68A',
          800: '#3D1F00',
          900: '#1C0A00',
        },
        // ── Tokens semánticos (resuelven en CSS vars) ─────────
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface:    'hsl(var(--surface))',
        border:     'hsl(var(--border))',
        muted:      {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        // Inter: legible, moderno, sin exceso de formalidad
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        // Sombras con tinte naranja para modo oscuro
        'brand-sm': '0 1px 3px rgba(234, 88, 12, 0.12)',
        'brand-md': '0 4px 12px rgba(234, 88, 12, 0.18)',
        'brand-lg': '0 8px 30px rgba(234, 88, 12, 0.22)',
      },
    },
  },
}
export default config
```

### Tokens CSS en `globals.css`

```css
/* app/globals.css */
@layer base {
  :root {
    /* ── MODO CLARO ─────────────────────────────── */
    --background:        28 100% 99%;   /* #FFFBF7 — blanco cálido */
    --foreground:        16 100% 8%;    /* #1C0A00 — casi negro cálido */
    --surface:           30 100% 97%;   /* #FFF7ED */
    --card:              0   0%  100%;  /* #FFFFFF */
    --card-foreground:   16 100% 8%;
    --border:            30  97% 87%;   /* #FED7AA */
    --muted:             30  60% 96%;
    --muted-foreground:  25  80% 28%;   /* #78350F */
    --primary:           20  90% 49%;   /* #EA580C */
    --primary-foreground: 0   0% 100%;
    --radius: 0.625rem;
  }

  .dark {
    /* ── MODO OSCURO ────────────────────────────── */
    --background:        20 100% 6%;    /* #150A00 — negro cálido profundo */
    --foreground:        30 100% 98%;   /* #FFF7ED */
    --surface:           20 100% 8%;    /* #1C0D00 */
    --card:              20 100% 10%;   /* #241100 */
    --card-foreground:   30 100% 98%;
    --border:            20  90% 18%;   /* #3D1F00 */
    --muted:             20  70% 14%;
    --muted-foreground:  25  55% 51%;   /* #C2763D */
    --primary:           20  90% 49%;   /* #EA580C — mismo en ambos modos */
    --primary-foreground: 0   0% 100%;
  }
}
```

### Implementación del Selector de Tema (FOUC-free)

```tsx
// components/theme-toggle.tsx
'use client'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1">
      {(['light', 'system', 'dark'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={cn(
            'rounded-md p-1.5 transition-all duration-150',
            theme === t
              ? 'bg-brand-600 text-white shadow-brand-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          aria-label={`Tema ${t}`}
        >
          {t === 'light'  && <Sun  size={14} />}
          {t === 'system' && <Monitor size={14} />}
          {t === 'dark'   && <Moon size={14} />}
        </button>
      ))}
    </div>
  )
}
```

### Aplicación del Color en Componentes Clave

```tsx
// Botón primario — CTA principal de la app
<button className="bg-brand-600 hover:bg-brand-700 active:bg-brand-800
                   text-white font-semibold rounded-lg px-4 py-2
                   shadow-brand-sm hover:shadow-brand-md
                   transition-all duration-150">
  Nueva Cita
</button>

// Badge de estado "Doble agenda" — usa el naranja más intenso
<span className="inline-flex items-center gap-1 rounded-full
                 bg-brand-100 dark:bg-brand-900/40
                 text-brand-700 dark:text-brand-400
                 text-xs font-semibold px-2 py-0.5 ring-1 ring-brand-300/50">
  ⭐ Doble cita
</span>

// Sidebar activo — fondo naranja suave
<li className="bg-brand-50 dark:bg-brand-900/20
               border-l-2 border-brand-600
               text-brand-700 dark:text-brand-400 font-medium">
  Agenda
</li>
```

---

## Características Principales

### Gestión de Citas Pro
- Calendario interactivo: vistas **Diaria · Semanal · Mensual**
- Crear, reagendar (drag & drop) y cancelar citas en tiempo real
- **Doble agenda por cliente** en el mismo día (ver sección dedicada)
- Código de colores semánticos por estado de cita
- Asignación de citas a empleados específicos
- Validación de solapamiento de horarios en tiempo real

### Recordatorios Inteligentes
- Notificaciones automáticas vía **WhatsApp Business API** y **Email**
- Ventana de tiempo configurable por tenant (24h, 2h, personalizado)
- Plantillas de mensajes con variables dinámicas: `{nombre}` `{servicio}` `{fecha}` `{hora}`
- Cola de mensajes asíncrona — la app no se bloquea si el servicio falla
- Log completo: `pendiente` → `enviado` → `entregado` → `leído` / `fallido`

### CRM de Clientes
- Ficha completa: nombre, teléfono, email, cumpleaños, notas internas, etiquetas
- Historial cronológico de todas las citas y servicios recibidos
- Métricas calculadas: frecuencia de visita, gasto total, ticket promedio
- Búsqueda en tiempo real (debounced) + filtros avanzados por tags y frecuencia

### Módulo Financiero
- Registro de cobros: monto, método, descuentos y propinas por cita
- Catálogo de servicios con precios base ajustables al cobrar
- Gastos operativos por categoría con adjunto de comprobante
- Dashboard con ingresos/gastos/ganancia neta en tiempo real

### Reportes en PDF
- Reporte de citas: semanal, mensual y anual
- Balance financiero con gráficas de ingresos vs. gastos
- Exportación directa en PDF con branding del negocio
- Generado 100% en el cliente con `@react-pdf/renderer` (sin carga en servidor)

### Autenticación y Multi-Tenancy
- Supabase Auth: registro, login, OAuth (Google), magic links
- **Aislamiento total** entre tenants con PostgreSQL RLS
- Roles granulares: `owner` · `employee` · `platform_admin`
- Sesiones seguras con JWT + refresh token rotatorio

### Experiencia de Usuario
- Diseño **mobile-first**, completamente responsive (320px → 4K)
- Tema **Claro · Oscuro · Sistema** con `next-themes` sin parpadeo (FOUC-free)
- **i18n**: Español 🇪🇸 · Inglés 🇺🇸 · extensible con `next-intl`
- Accesibilidad WAI-ARIA compliant via shadcn/ui + Radix UI

---

## ⭐ Doble Agenda — La Función Estrella que nos Diferencia

> **"El cliente pidió corte a las 10:00 y coloración a las 15:00. Con Agendo, eso es posible en dos clics."**

La mayoría de los sistemas de agenda bloquean al cliente una vez que tiene una cita activa en el día. **Agendo rompe esa limitación** con un motor de agenda inteligente que permite múltiples citas el mismo día por cliente.

### Cómo funciona técnicamente

#### 1. Validación en la Base de Datos

```sql
-- Función que cuenta citas activas del cliente en un día específico
CREATE OR REPLACE FUNCTION count_client_appointments_on_date(
  p_business_id  UUID,
  p_client_id    UUID,
  p_date         DATE,
  p_exclude_id   UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM appointments
  WHERE business_id = p_business_id
    AND client_id   = p_client_id
    AND status      NOT IN ('cancelled', 'no_show')
    AND DATE(start_at AT TIME ZONE 'UTC') = p_date
    AND (p_exclude_id IS NULL OR id != p_exclude_id);
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Verificar solapamiento de horarios del empleado
CREATE OR REPLACE FUNCTION check_employee_overlap(
  p_business_id  UUID,
  p_user_id      UUID,
  p_start_at     TIMESTAMPTZ,
  p_end_at       TIMESTAMPTZ,
  p_exclude_id   UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM appointments
    WHERE business_id   = p_business_id
      AND assigned_user = p_user_id
      AND status        NOT IN ('cancelled', 'no_show')
      AND (p_exclude_id IS NULL OR id != p_exclude_id)
      AND tstzrange(start_at, end_at) && tstzrange(p_start_at, p_end_at)
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

#### 2. Lógica de Validación en TypeScript

```typescript
// lib/appointments/validate-double-booking.ts
export const DoubleBookingWarningLevel = {
  ALLOWED: 'allowed',  // 0 citas ese día → proceder normalmente
  WARN:    'warn',     // 1 cita ese día → aviso, el usuario confirma
  BLOCKED: 'blocked',  // 2+ citas ese día → bloqueado
} as const

export async function checkDoubleBooking(
  repo: AppointmentRepository,
  params: { businessId: string; clientId: string; date: Date; excludeId?: string }
): Promise<DoubleBookingCheckResult> {
  const { existingCount, slots } = await repo.countClientAppointmentsOnDate(params)

  if (existingCount === 0) {
    return { level: 'allowed', existingCount: 0, existingSlots: [], message: '' }
  }
  if (existingCount === 1) {
    return {
      level: 'warn',
      existingCount: 1,
      existingSlots: slots,
      message: `Este cliente ya tiene 1 cita ese día (${slots[0].time} — ${slots[0].service}). ¿Agregar una segunda cita?`,
    }
  }
  return {
    level: 'blocked',
    existingCount,
    existingSlots: slots,
    message: `Este cliente ya tiene ${existingCount} citas ese día. Límite de doble agenda alcanzado.`,
  }
}
```

#### 3. Flujo UX de Doble Agenda

```
[Usuario crea cita] → [Selecciona cliente + fecha]
          │
          ▼
  [count_client_appointments_on_date()]
          │
    ┌─────┴──────────────────┐
    │                        │
  count=0                 count=1                    count≥2
    │                        │                          │
    ▼                        ▼                          ▼
[✅ Procede             [⚠️ Modal de             [🚫 Bloqueado]
 normal]                 confirmación]          "Límite de doble
                         "Ya tiene 1 cita.       agenda alcanzado"
                          ¿Agregar 2da?"
                               │
                          [Confirma]
                               │
                               ▼
                    [✅ Cita creada con
                     is_dual_booking=true]
```

#### 4. Visualización en el Calendario

```tsx
// components/calendar/appointment-card.tsx
function AppointmentCard({ appointment }: { appointment: Appointment }) {
  return (
    <div className={cn(
      'rounded-md border-l-4 p-2 text-xs',
      statusColors[appointment.status],
      appointment.isDualBooking && 'ring-2 ring-brand-600 ring-offset-1'
    )}>
      {appointment.isDualBooking && (
        <span className="mb-1 flex items-center gap-1 text-brand-600 dark:text-brand-400">
          <Star size={10} fill="currentColor" />
          <span className="font-semibold">Doble cita</span>
        </span>
      )}
      <p className="font-medium">{appointment.client.name}</p>
      <p className="text-muted-foreground">{appointment.service.name}</p>
    </div>
  )
}
```

---

## Stack Tecnológico

```
CAPA                TECNOLOGÍA                          PROPÓSITO
─────────────────────────────────────────────────────────────────────────────
Frontend            Next.js 14+ (App Router)            Framework principal, SSR/RSC
Lenguaje            TypeScript (modo estricto)           Type-safety de extremo a extremo
Estilos             Tailwind CSS 3.x                    Utility-first, tokens de diseño
Componentes         shadcn/ui + Radix UI                Accesibilidad WAI-ARIA
Tema                next-themes                         Dark mode sin FOUC
─────────────────────────────────────────────────────────────────────────────
Base de Datos       Supabase (PostgreSQL 15)             Multi-tenant con RLS nativo
Autenticación       Supabase Auth                       JWT, OAuth, magic links
Tiempo Real         Supabase Realtime                   Calendario sincronizado
Edge Functions      Supabase Edge Functions             Cron de notificaciones
─────────────────────────────────────────────────────────────────────────────
Validación          Zod 3.x                             Schemas type-safe client+server
Formularios         React Hook Form 7.x                 Performance, integración con Zod
Estado/Cache        TanStack Query 5.x                  Server state, optimistic updates
─────────────────────────────────────────────────────────────────────────────
Generación PDF      @react-pdf/renderer                 PDF en browser, sin servidor
Email               Resend + React Email                Transaccional, alta deliverability
WhatsApp            Twilio WhatsApp Business API        Recordatorios automatizados
i18n                next-intl 3.x                       Integración nativa App Router
─────────────────────────────────────────────────────────────────────────────
Testing             Vitest + Testing Library            Unit + integration tests
E2E                 Playwright                          Tests de flujos críticos
Deploy              Vercel                              CI/CD + Edge Network
Monitoreo           Sentry + Vercel Analytics           Errores + Core Web Vitals
─────────────────────────────────────────────────────────────────────────────
```

---

## Arquitectura Database-Agnostic

> **Principio fundamental:** *La lógica de negocio de Agendo no sabe (ni le importa) dónde viven los datos.*

Agendo implementa el **Patrón Repositorio** con una capa de abstracción completa. Si mañana decides migrar de Supabase a PlanetScale, Neon o cualquier otra base de datos, **el frontend y la lógica de negocio permanecen 100% intactos**.

### Capa 1: Interfaces (Contratos agnósticos)

```typescript
// lib/repositories/interfaces/appointment.repository.ts

export interface AppointmentRepository {
  findById(id: string, businessId: string): Promise<Appointment | null>
  findMany(filters: AppointmentFilters, pagination?: PaginationOptions): Promise<PaginatedResult<Appointment>>
  create(data: CreateAppointmentDTO): Promise<Appointment>
  update(id: string, businessId: string, data: UpdateAppointmentDTO): Promise<Appointment>
  softDelete(id: string, businessId: string, reason?: string): Promise<void>
  countClientAppointmentsOnDate(params: {
    businessId: string; clientId: string; date: Date; excludeId?: string
  }): Promise<{ existingCount: number; slots: Array<{ time: string; service: string }> }>
  checkEmployeeOverlap(params: {
    businessId: string; userId: string; startAt: Date; endAt: Date; excludeId?: string
  }): Promise<boolean>
}
```

### Capa 2: Implementaciones Concretas (intercambiables)

```typescript
// lib/repositories/supabase/appointment.repository.ts
export class SupabaseAppointmentRepository implements AppointmentRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findById(id: string, businessId: string): Promise<Appointment | null> {
    const { data, error } = await this.client
      .from('appointments')
      .select('*, client:clients(*), service:services(*), assigned_user:users(id,name,avatar_url)')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()
    if (error || !data) return null
    return mapToAppointment(data)
  }
  // ... resto de métodos
}

// lib/repositories/mock/appointment.repository.ts → Para tests unitarios
// lib/repositories/prisma/appointment.repository.ts → Migración futura posible
```

### Capa 3: Contenedor de Dependencias

```typescript
// lib/repositories/container.ts
export function createRepositoryContainer() {
  const supabase = createServerClient()
  return {
    appointments: new SupabaseAppointmentRepository(supabase),
    clients:      new SupabaseClientRepository(supabase),
    finances:     new SupabaseFinanceRepository(supabase),
  } as const
}
```

### Capa 4: Lógica de Negocio (solo usa interfaces)

```typescript
// lib/appointments/create-appointment.usecase.ts
export async function createAppointmentUseCase(repos: RepositoryContainer, input: unknown) {
  // 1. Validar con Zod
  const data = CreateAppointmentSchema.parse(input)

  // 2. Verificar doble agenda
  const doubleCheck = await checkDoubleBooking(repos.appointments, {
    businessId: data.businessId, clientId: data.clientId, date: data.startAt,
  })
  if (doubleCheck.level === 'blocked') throw new BusinessRuleError(doubleCheck.message)

  // 3. Verificar solapamiento del empleado
  if (data.assignedUserId) {
    const hasOverlap = await repos.appointments.checkEmployeeOverlap({ ...data })
    if (hasOverlap) throw new BusinessRuleError('El empleado ya tiene una cita en ese horario.')
  }

  // 4. Crear la cita — repos.appointments podría ser Supabase, Prisma o cualquier otro
  const appointment = await repos.appointments.create({
    ...data,
    isDualBooking: doubleCheck.level === 'warn',
  })

  return { appointment, warning: doubleCheck.level === 'warn' ? doubleCheck : null }
}
```

### Diagrama de Capas

```
┌──────────────────────────────────────────────────────────────┐
│                  UI / React Components                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ llama a
┌──────────────────────────▼───────────────────────────────────┐
│             Next.js Server Actions                            │
│       (validan con Zod, invocan casos de uso)                │
└──────────────────────────┬───────────────────────────────────┘
                           │ usa
┌──────────────────────────▼───────────────────────────────────┐
│         Casos de Uso / Lógica de Negocio                      │
│   ← Solo conoce INTERFACES, no implementaciones concretas → │
└──────────────────────────┬───────────────────────────────────┘
                           │ implementado por
┌──────────────────────────▼───────────────────────────────────┐
│      Repositorios Concretos (completamente intercambiables)   │
│  SupabaseRepo  │  PrismaRepo  │  MockRepo (tests)            │
└──────────────────────────┬───────────────────────────────────┘
                           │ conecta a
┌──────────────────────────▼───────────────────────────────────┐
│       Base de Datos (Supabase/PostgreSQL hoy)                 │
│  ← Reemplazable sin modificar ninguna capa superior →       │
└──────────────────────────────────────────────────────────────┘
```

---

## Validación y Tipado Robusto: Zod + TypeScript

El mismo schema Zod valida el formulario en el cliente, el Server Action en el servidor y genera los tipos TypeScript automáticamente — **una sola fuente de verdad**.

### Schemas Centralizados

```typescript
// lib/validations/appointment.schema.ts
import { z } from 'zod'

export const AppointmentStatusSchema = z.enum([
  'pending', 'confirmed', 'completed', 'cancelled', 'no_show'
])
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>

export const CreateAppointmentSchema = z.object({
  businessId:     z.string().uuid('ID de negocio inválido'),
  clientId:       z.string().uuid('Debes seleccionar un cliente'),
  serviceId:      z.string().uuid('Debes seleccionar un servicio'),
  assignedUserId: z.string().uuid().optional(),
  startAt:        z.coerce.date().refine(
    (d) => d > new Date(),
    { message: 'La cita debe ser en el futuro' }
  ),
  endAt:        z.coerce.date(),
  notes:        z.string().max(500).optional(),
  confirmDouble: z.boolean().default(false),
}).refine(
  (data) => data.endAt > data.startAt,
  { message: 'La hora de fin debe ser posterior al inicio', path: ['endAt'] }
)

export type CreateAppointmentDTO = z.infer<typeof CreateAppointmentSchema>
```

```typescript
// lib/validations/client.schema.ts
export const CreateClientSchema = z.object({
  businessId: z.string().uuid(),
  name:       z.string().min(2, 'El nombre es muy corto').max(100),
  phone:      z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Número inválido').optional().or(z.literal('')),
  email:      z.string().email('Email inválido').optional().or(z.literal('')),
  birthday:   z.coerce.date().max(new Date(), 'Fecha inválida').optional(),
  notes:      z.string().max(1000).optional(),
  tags:       z.array(z.string().min(1).max(30)).max(10, 'Máximo 10 etiquetas').default([]),
})
export type CreateClientDTO = z.infer<typeof CreateClientSchema>
```

### TypeScript Modo Estricto: `tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Validación Doble en Server Actions

```typescript
// app/[locale]/(dashboard)/appointments/actions.ts
'use server'
export async function createAppointmentAction(rawInput: unknown) {
  const session = await getServerSession()
  if (!session) return { error: 'No autenticado' }

  // Validación Zod — rechaza cualquier input malformado
  const result = CreateAppointmentSchema.safeParse(rawInput)
  if (!result.success) {
    return { error: 'Datos inválidos', fieldErrors: result.error.flatten().fieldErrors }
  }

  // Autorización explícita — el business_id debe coincidir con el del usuario
  if (result.data.businessId !== session.businessId) {
    return { error: 'No autorizado' }
  }

  try {
    const repos = createRepositoryContainer()
    const { appointment, warning } = await createAppointmentUseCase(repos, result.data)
    return { success: true, appointment, warning }
  } catch (err) {
    if (err instanceof BusinessRuleError) return { error: err.message }
    return { error: 'Error interno del servidor' }
  }
}
```

---

## Seguridad Multi-Tenant Extrema

> **Garantía absoluta:** Ningún usuario puede ver, modificar ni eliminar datos de otro negocio, ni siquiera si conoce los UUIDs de sus registros.

### Arquitectura de Seguridad en Capas

```
CAPA 1: JWT Claims      → El token incluye business_id como claim personalizado
CAPA 2: Server Actions  → Validación explícita businessId === session.businessId
CAPA 3: RLS Policies    → PostgreSQL rechaza queries que violen el tenant a nivel de BD
CAPA 4: Soft Delete     → Datos eliminados nunca desaparecen (auditoría completa)
```

### Implementación Completa de RLS

```sql
-- ══════════════════════════════════════════════
-- FUNCIONES HELPER (SECURITY DEFINER)
-- Ejecutan con permisos del propietario de la función,
-- no del usuario que las invoca. Previene escalación de privilegios.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION agendo_get_business_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT business_id FROM users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION agendo_has_role(required_role TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = required_role
  );
$$;

-- ══════════════════════════════════════════════
-- RLS: businesses
-- ══════════════════════════════════════════════
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "businesses_owner_select" ON businesses FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "businesses_owner_update" ON businesses FOR UPDATE
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "businesses_insert" ON businesses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- ══════════════════════════════════════════════
-- RLS: appointments (patrón estándar de tenant)
-- ══════════════════════════════════════════════
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_tenant_select" ON appointments FOR SELECT
  USING (business_id = agendo_get_business_id());

CREATE POLICY "appointments_tenant_insert" ON appointments FOR INSERT
  WITH CHECK (business_id = agendo_get_business_id());

CREATE POLICY "appointments_tenant_update" ON appointments FOR UPDATE
  USING (business_id = agendo_get_business_id())
  WITH CHECK (business_id = agendo_get_business_id());

-- Solo propietarios pueden eliminar físicamente
CREATE POLICY "appointments_owner_delete" ON appointments FOR DELETE
  USING (business_id = agendo_get_business_id() AND agendo_has_role('owner'));

-- ══════════════════════════════════════════════
-- RLS: transactions y expenses (solo owners)
-- Los empleados NO pueden ver información financiera
-- ══════════════════════════════════════════════
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_owner_only" ON transactions FOR ALL
  USING    (business_id = agendo_get_business_id() AND agendo_has_role('owner'))
  WITH CHECK (business_id = agendo_get_business_id() AND agendo_has_role('owner'));

CREATE POLICY "expenses_owner_only" ON expenses FOR ALL
  USING    (business_id = agendo_get_business_id() AND agendo_has_role('owner'))
  WITH CHECK (business_id = agendo_get_business_id() AND agendo_has_role('owner'));

-- ══════════════════════════════════════════════
-- RLS: clients, services, notifications (patrón estándar)
-- ══════════════════════════════════════════════
ALTER TABLE clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;

-- Política reutilizable: cada tabla con su nombre
CREATE POLICY "clients_tenant_isolation" ON clients FOR ALL
  USING    (business_id = agendo_get_business_id())
  WITH CHECK (business_id = agendo_get_business_id());

CREATE POLICY "services_tenant_isolation" ON services FOR ALL
  USING    (business_id = agendo_get_business_id())
  WITH CHECK (business_id = agendo_get_business_id());

CREATE POLICY "users_tenant_select" ON users FOR SELECT
  USING (business_id = agendo_get_business_id());

CREATE POLICY "users_self_update" ON users FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (business_id = agendo_get_business_id());

-- ══════════════════════════════════════════════
-- HARDENING: Revocar acceso anon a todas las tablas
-- Solo el rol 'authenticated' accede, siempre filtrado por RLS
-- ══════════════════════════════════════════════
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Verificación post-migración: todas deben mostrar rowsecurity=true
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'businesses','users','clients','services',
    'appointments','transactions','expenses',
    'notifications','notification_templates'
  )
ORDER BY tablename;
```

---

## Guía de Instalación

### Prerrequisitos

- **Node.js** >= 18.17.0
- **pnpm** >= 8.x (recomendado) o npm >= 9.x
- Cuenta en [Supabase](https://supabase.com) (tier gratuito para desarrollo)
- Cuenta en [Vercel](https://vercel.com) para deploy
- Cuenta en [Twilio](https://twilio.com) (sandbox gratis disponible)
- Cuenta en [Resend](https://resend.com) (3,000 emails/mes gratis)

### 1. Clonar el Repositorio

```bash
git clone https://github.com/tu-usuario/agendo.git
cd agendo
```

### 2. Instalar Dependencias

```bash
pnpm install
```

### 3. Configurar Supabase

```bash
# Instalar CLI
pnpm add -g supabase

# Autenticarse y linkear proyecto
supabase login
supabase link --project-ref TU_PROJECT_REF

# Aplicar schema y migraciones
supabase db push

# Generar tipos TypeScript desde tu schema (repetir al hacer cambios)
supabase gen types typescript --linked > types/supabase.ts
```

### 4. Variables de Entorno

```bash
cp .env.example .env.local
# Edita .env.local con tus credenciales
```

### 5. Ejecutar en Desarrollo

```bash
pnpm dev
# Abre http://localhost:3000
```

### 6. Ejecutar Tests

```bash
pnpm test           # Unit tests (Vitest)
pnpm test:e2e       # E2E tests (Playwright)
pnpm test:coverage  # Reporte de cobertura
```

### 7. Build y Deploy

```bash
pnpm build && pnpm start   # Producción local

# Deploy en Vercel
pnpm add -g vercel
vercel --prod
```

---

## Variables de Entorno

```env
# ══════════════════════════════════════════
# SUPABASE
# ══════════════════════════════════════════
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# ⚠️ SERVICE_ROLE_KEY: NUNCA usar en el cliente. Solo Edge Functions y migraciones.

# ══════════════════════════════════════════
# TWILIO — WhatsApp Business API
# ══════════════════════════════════════════
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# ══════════════════════════════════════════
# RESEND — Email transaccional
# ══════════════════════════════════════════
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@agendo.app
RESEND_FROM_NAME=Agendo

# ══════════════════════════════════════════
# APP
# ══════════════════════════════════════════
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Agendo
# Generar con: openssl rand -base64 32
NEXTAUTH_SECRET=tu-secreto-super-seguro-de-32-bytes

# ══════════════════════════════════════════
# OPCIONAL — Sentry
# ══════════════════════════════════════════
SENTRY_DSN=https://xxxx@xxxx.ingest.sentry.io/xxxx
NEXT_PUBLIC_SENTRY_DSN=https://xxxx@xxxx.ingest.sentry.io/xxxx

# ══════════════════════════════════════════
# OPCIONAL — Upstash Redis (Fase 2)
# ══════════════════════════════════════════
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxx
```

---

## Esquema de Base de Datos Completo

### Diagrama de Relaciones

```
businesses (tenant raíz)
    │
    ├── users ────────────────────── empleados del negocio
    ├── clients ──────────────────── CRM de clientes
    ├── services ─────────────────── catálogo de servicios
    │
    ├── appointments ─────────────── citas agendadas
    │       ├── [client_id  → clients]
    │       ├── [service_id → services]
    │       ├── [assigned_user → users]
    │       ├── transactions ──────── cobros por cita
    │       └── notifications ──────── recordatorios enviados
    │
    ├── expenses ─────────────────── gastos operativos
    └── notification_templates ───── plantillas de mensajes
```

### SQL Completo

```sql
-- ════════════════════════════════════════════
-- EXTENSIONES Y TIPOS
-- ════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE business_plan        AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE user_role            AS ENUM ('owner', 'employee', 'platform_admin');
CREATE TYPE appointment_status   AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE payment_method       AS ENUM ('cash', 'card', 'transfer', 'qr', 'other');
CREATE TYPE notification_channel AS ENUM ('whatsapp', 'email');
CREATE TYPE notification_status  AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE expense_category     AS ENUM ('supplies', 'rent', 'utilities', 'payroll', 'marketing', 'equipment', 'other');

-- ════════════════════════════════════════════
-- businesses — TENANT RAÍZ
-- ════════════════════════════════════════════
CREATE TABLE businesses (
  id         UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id   UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT          NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  slug       TEXT          UNIQUE,
  category   TEXT          NOT NULL,
  phone      TEXT,
  address    TEXT,
  logo_url   TEXT,
  plan       business_plan NOT NULL DEFAULT 'free',
  settings   JSONB         NOT NULL DEFAULT '{
    "notifications": {"whatsapp": true, "email": true, "reminderHours": [24, 2]},
    "workingHours":  {"mon":["09:00","18:00"],"tue":["09:00","18:00"],
                      "wed":["09:00","18:00"],"thu":["09:00","18:00"],
                      "fri":["09:00","18:00"],"sat":["09:00","14:00"],"sun":null},
    "maxDailyBookingsPerClient": 2
  }'::jsonb,
  timezone   TEXT          NOT NULL DEFAULT 'America/Bogota',
  locale     TEXT          NOT NULL DEFAULT 'es',
  created_at TIMESTAMPTZ   DEFAULT NOW(),
  updated_at TIMESTAMPTZ   DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- users — EXTENSIÓN DE auth.users
-- ════════════════════════════════════════════
CREATE TABLE users (
  id          UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  business_id UUID      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'employee',
  name        TEXT      NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  phone       TEXT,
  avatar_url  TEXT,
  color       TEXT      DEFAULT '#EA580C',
  is_active   BOOLEAN   NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- clients — CRM
-- ════════════════════════════════════════════
CREATE TABLE clients (
  id                  UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id         UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  phone               TEXT,
  email               TEXT,
  birthday            DATE,
  notes               TEXT        CHECK (char_length(notes) <= 1000),
  tags                TEXT[]      NOT NULL DEFAULT '{}',
  avatar_url          TEXT,
  -- Métricas cacheadas (actualizadas por trigger)
  total_appointments  INTEGER     NOT NULL DEFAULT 0,
  total_spent         NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_visit_at       TIMESTAMPTZ,
  -- Soft delete
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- services — CATÁLOGO
-- ════════════════════════════════════════════
CREATE TABLE services (
  id           UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id  UUID          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT          NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  description  TEXT          CHECK (char_length(description) <= 500),
  duration_min INTEGER       NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 480),
  price        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  category     TEXT,
  color        TEXT          NOT NULL DEFAULT '#EA580C',
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- appointments — TABLA CENTRAL
-- ════════════════════════════════════════════
CREATE TABLE appointments (
  id              UUID               DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id     UUID               NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id       UUID               NOT NULL REFERENCES clients(id),
  service_id      UUID               NOT NULL REFERENCES services(id),
  assigned_user   UUID               REFERENCES users(id) ON DELETE SET NULL,
  start_at        TIMESTAMPTZ        NOT NULL,
  end_at          TIMESTAMPTZ        NOT NULL,
  status          appointment_status NOT NULL DEFAULT 'pending',
  notes           TEXT               CHECK (char_length(notes) <= 500),
  is_dual_booking BOOLEAN            NOT NULL DEFAULT FALSE,  -- ⭐ Función estrella
  cancel_reason   TEXT,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID               REFERENCES users(id),
  created_at      TIMESTAMPTZ        DEFAULT NOW(),
  updated_at      TIMESTAMPTZ        DEFAULT NOW(),

  CONSTRAINT valid_time_range CHECK (end_at > start_at),
  CONSTRAINT valid_duration   CHECK (
    EXTRACT(EPOCH FROM (end_at - start_at)) / 60 BETWEEN 5 AND 480
  )
);

-- ════════════════════════════════════════════
-- transactions — COBROS
-- ════════════════════════════════════════════
CREATE TABLE transactions (
  id              UUID            DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id     UUID            NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id  UUID            REFERENCES appointments(id) ON DELETE SET NULL,
  amount          NUMERIC(10,2)   NOT NULL CHECK (amount > 0),
  discount        NUMERIC(5,2)    NOT NULL DEFAULT 0 CHECK (discount BETWEEN 0 AND 100),
  tip             NUMERIC(10,2)   NOT NULL DEFAULT 0 CHECK (tip >= 0),
  -- Monto neto calculado automáticamente
  net_amount      NUMERIC(10,2)   GENERATED ALWAYS AS (
    ROUND(amount * (1 - discount / 100) + tip, 2)
  ) STORED,
  method          payment_method  NOT NULL DEFAULT 'cash',
  notes           TEXT,
  paid_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- expenses — GASTOS OPERATIVOS
-- ════════════════════════════════════════════
CREATE TABLE expenses (
  id           UUID             DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id  UUID             NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category     expense_category NOT NULL,
  amount       NUMERIC(10,2)    NOT NULL CHECK (amount > 0),
  description  TEXT             CHECK (char_length(description) <= 200),
  receipt_url  TEXT,
  expense_date DATE             NOT NULL DEFAULT CURRENT_DATE,
  created_by   UUID             REFERENCES users(id),
  created_at   TIMESTAMPTZ      DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- notifications — LOG DE RECORDATORIOS
-- ════════════════════════════════════════════
CREATE TABLE notifications (
  id              UUID                 DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id     UUID                 NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id  UUID                 NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  channel         notification_channel NOT NULL,
  status          notification_status  NOT NULL DEFAULT 'pending',
  provider_id     TEXT,
  error_message   TEXT,
  scheduled_at    TIMESTAMPTZ          NOT NULL,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ          DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- notification_templates
-- ════════════════════════════════════════════
CREATE TABLE notification_templates (
  id             UUID                 DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id    UUID                 NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel        notification_channel NOT NULL,
  trigger_hours  INTEGER              NOT NULL DEFAULT 24 CHECK (trigger_hours BETWEEN 1 AND 168),
  subject        TEXT,
  -- Variables: {nombre_cliente} {servicio} {fecha} {hora} {negocio} {direccion}
  body           TEXT                 NOT NULL,
  is_active      BOOLEAN              NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ          DEFAULT NOW(),
  UNIQUE(business_id, channel, trigger_hours)
);

-- ════════════════════════════════════════════
-- ÍNDICES DE RENDIMIENTO
-- ════════════════════════════════════════════
CREATE INDEX idx_appointments_tenant_date ON appointments(business_id, start_at);
CREATE INDEX idx_appointments_client_date ON appointments(client_id, start_at);
CREATE INDEX idx_appointments_status      ON appointments(business_id, status);
CREATE INDEX idx_appointments_user_date   ON appointments(assigned_user, start_at) WHERE assigned_user IS NOT NULL;
CREATE INDEX idx_appointments_dual        ON appointments(business_id, client_id, start_at) WHERE is_dual_booking = TRUE;
CREATE INDEX idx_clients_tenant           ON clients(business_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_phone            ON clients(business_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_clients_tags             ON clients USING gin(tags);
CREATE INDEX idx_transactions_tenant_date ON transactions(business_id, paid_at);
CREATE INDEX idx_expenses_tenant_date     ON expenses(business_id, expense_date);
CREATE INDEX idx_notifications_pending    ON notifications(scheduled_at, status) WHERE status = 'pending';

-- ════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_upd   BEFORE UPDATE ON businesses   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_upd        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_upd      BEFORE UPDATE ON clients      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_upd     BEFORE UPDATE ON services     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_appointments_upd BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Actualizar métricas del cliente al completar cita
CREATE OR REPLACE FUNCTION update_client_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE clients SET total_appointments = total_appointments + 1, last_visit_at = NEW.end_at WHERE id = NEW.client_id;
  END IF;
  IF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    UPDATE clients SET total_appointments = GREATEST(total_appointments - 1, 0) WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_appointment_metrics
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_client_metrics();
```

---

## Estructura del Proyecto

```
agendo/
├── app/
│   ├── [locale]/                         # i18n routing (es, en)
│   │   ├── (auth)/                       # Rutas públicas
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── forgot-password/
│   │   └── (dashboard)/                  # Rutas protegidas
│   │       ├── appointments/             # Calendario y citas
│   │       ├── clients/                  # CRM de clientes
│   │       ├── finances/                 # Módulo financiero
│   │       ├── reports/                  # Reportes PDF
│   │       └── settings/                 # Config del negocio
│   └── api/
│       ├── webhooks/twilio/              # Estado mensajes WhatsApp
│       └── webhooks/resend/              # Estado mensajes Email
│
├── components/
│   ├── ui/                               # shadcn/ui components
│   ├── calendar/
│   │   ├── calendar-day-view.tsx
│   │   ├── calendar-week-view.tsx
│   │   ├── appointment-card.tsx          # ⭐ Con indicador doble agenda
│   │   └── drag-drop-provider.tsx
│   ├── forms/                            # Formularios tipados con Zod
│   ├── pdf/                              # Templates react-pdf
│   └── theme-toggle.tsx
│
├── lib/
│   ├── repositories/
│   │   ├── interfaces/                   # Contratos agnósticos de BD
│   │   │   ├── appointment.repository.ts
│   │   │   ├── client.repository.ts
│   │   │   └── finance.repository.ts
│   │   ├── supabase/                     # Implementaciones concretas
│   │   ├── mock/                         # Para tests unitarios
│   │   └── container.ts                  # Composición de dependencias
│   │
│   ├── appointments/                     # Lógica de negocio
│   │   ├── create-appointment.usecase.ts
│   │   ├── validate-double-booking.ts    # ⭐ Función estrella
│   │   └── check-employee-overlap.ts
│   │
│   ├── validations/                      # Schemas Zod centralizados
│   │   ├── appointment.schema.ts
│   │   ├── client.schema.ts
│   │   └── finance.schema.ts
│   │
│   ├── supabase/
│   │   ├── client.ts                     # Browser client
│   │   ├── server.ts                     # SSR/Server Actions client
│   │   └── middleware.ts
│   │
│   └── notifications/
│       ├── whatsapp.service.ts
│       └── email.service.ts
│
├── messages/
│   ├── es.json
│   └── en.json
│
├── types/
│   ├── supabase.ts                       # Auto-generado: supabase gen types
│   └── index.ts
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── schema.sql
│
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json                         # strict mode habilitado
└── vitest.config.ts
```

---

## Seguridad — Resumen Ejecutivo

| Capa | Tecnología | Qué protege |
|---|---|---|
| **Transport** | HTTPS/TLS 1.3 + HSTS | Datos en tránsito |
| **Autenticación** | Supabase Auth + JWT | Identidad del usuario |
| **Autorización** | PostgreSQL RLS | Aislamiento de tenant en BD |
| **Validación** | Zod (client + server) | Integridad de datos de entrada |
| **Headers** | CSP + X-Frame-Options | XSS, clickjacking |
| **Rate Limiting** | Supabase + middleware | Fuerza bruta |
| **Auditoría** | Soft delete + timestamps | Trazabilidad completa |
| **Secretos** | Env vars (servidor only) | Keys nunca expuestas al cliente |

Para reportar vulnerabilidades: **security@agendo.app** — no abras un issue público.

---

## Roadmap

### MVP v1.0 — En Desarrollo
- [x] Arquitectura database-agnostic con Patrón Repositorio
- [x] Seguridad multi-tenant extrema (RLS completo)
- [x] Schemas Zod + TypeScript modo estricto
- [ ] Módulo de citas con **Doble Agenda ⭐**
- [ ] CRM de clientes con historial y métricas
- [ ] Recordatorios WhatsApp + Email automáticos
- [ ] Módulo financiero (cobros + gastos)
- [ ] Reportes en PDF con branding del negocio
- [ ] Tema Claro / Oscuro / Sistema (FOUC-free)
- [ ] i18n Español / Inglés

### Fase 2 — v1.5
- [ ] Progressive Web App (PWA + offline)
- [ ] Pagos con Stripe (planes de suscripción)
- [ ] Múltiples empleados con roles granulares
- [ ] MFA / TOTP opcional
- [ ] Caché avanzado con Upstash Redis

### Fase 3 — v2.0
- [ ] Portal público de reservas para clientes finales
- [ ] Facturación electrónica (CFDI México / DIAN Colombia)
- [ ] API pública con OpenAPI 3.0
- [ ] Integraciones: Google Calendar, Outlook, Instagram DM

### Fase 4 — v2.5
- [ ] IA: predicción de no-shows y sugerencias de horario
- [ ] Optimización automática de agenda
- [ ] Marketplace de plugins de terceros
- [ ] App móvil nativa (React Native / Expo)

---

## Contribución

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un PR.

```bash
# Fork → crea tu rama
git checkout -b feature/nombre-descriptivo

# Desarrolla y escribe tests
pnpm test

# Verifica tipos y linting
pnpm typecheck && pnpm lint

# Commit con Conventional Commits
git commit -m "feat(appointments): add visual indicator for dual booking"

# Push y abre PR
git push origin feature/nombre-descriptivo
```

**Tipos de commit:** `feat` · `fix` · `docs` · `style` · `refactor` · `test` · `chore`

---

## Licencia

Distribuido bajo la **Licencia MIT**. Consulta [LICENSE](LICENSE) para más información.

---

<div align="center">

**Agendo** — *Tu negocio en control, tus clientes en orden.*

Construido con ❤️ para negocios locales latinoamericanos

[agendo.app](https://agendo.app) &nbsp;·&nbsp; [docs.agendo.app](https://docs.agendo.app) &nbsp;·&nbsp; [security@agendo.app](mailto:security@agendo.app)

</div>
