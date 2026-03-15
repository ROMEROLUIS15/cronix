'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { Tables } from '@/types/database.types'

// ── Types ──────────────────────────────────────────────────────────────────────
type UserProfile = Pick<
  Tables<'users'>,
  'name' | 'role' | 'business_id' | 'avatar_url' | 'color'
> | null

type BusinessProfile = Pick<Tables<'businesses'>, 'name' | 'category'> | null

interface DashboardShellProps {
  children: React.ReactNode
  user:     UserProfile
  business: BusinessProfile
}

// ── Page title map ─────────────────────────────────────────────────────────────
const PAGE_TITLES: Array<{
  match:     (p: string) => boolean
  title:     string
  subtitle?: string
}> = [
  { match: p => p === '/dashboard',                 title: 'Dashboard',             subtitle: 'Resumen general'      },
  { match: p => p.includes('/appointments/new'),    title: 'Nueva Cita',            subtitle: 'Agenda'               },
  { match: p => /\/appointments\/.+\/edit/.test(p), title: 'Editar Cita',           subtitle: 'Agenda'               },
  { match: p => p.includes('/appointments'),        title: 'Agenda',                subtitle: 'Gestión de citas'     },
  { match: p => p.includes('/clients/new'),         title: 'Nuevo Cliente',         subtitle: 'Clientes'             },
  { match: p => /\/clients\/.+\/edit/.test(p),      title: 'Editar Cliente',        subtitle: 'Clientes'             },
  { match: p => /\/clients\/.+/.test(p),            title: 'Perfil del Cliente',    subtitle: 'Clientes'             },
  { match: p => p.includes('/clients'),             title: 'Clientes',              subtitle: 'Base de datos'        },
  { match: p => p.includes('/services'),            title: 'Servicios',             subtitle: 'Catálogo'             },
  { match: p => p.includes('/settings'),            title: 'Configuración',         subtitle: 'Preferencias'         },
  { match: p => p.includes('/profile'),             title: 'Mi Perfil',             subtitle: 'Cuenta'               },
  { match: p => p.includes('/finances'),            title: 'Finanzas',              subtitle: 'Reportes financieros' },
  { match: p => p.includes('/reports'),             title: 'Reportes',              subtitle: 'Estadísticas'         },
  { match: p => p.includes('/setup'),               title: 'Configuración Inicial', subtitle: 'Bienvenido'           },
]

function getPageMeta(pathname: string): { title: string; subtitle?: string } {
  for (const entry of PAGE_TITLES) {
    if (entry.match(pathname)) return { title: entry.title, subtitle: entry.subtitle }
  }
  return { title: 'Dashboard' }
}

// ── Component ──────────────────────────────────────────────────────────────────
export function DashboardShell({ children, user, business }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const { title, subtitle } = getPageMeta(pathname ?? '')

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add('scroll-locked')
    } else {
      document.body.classList.remove('scroll-locked')
    }
    return () => {
      document.body.classList.remove('scroll-locked')
    }
  }, [sidebarOpen])

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0F0F12' }}>

      {/* Sidebar — desktop */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar open={true} user={user} business={business} />
      </div>

      {/* Sidebar — mobile overlay */}
      <div className="lg:hidden">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          business={business}
        />
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setSidebarOpen(prev => !prev)}
          user={user}
        />
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ backgroundColor: '#0F0F12' }}
        >
          <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}