'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays, Users, DollarSign, BarChart3,
  Settings, ChevronRight, Scissors, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard',          label: 'Agenda',    icon: CalendarDays },
  { href: '/dashboard/clients',  label: 'Clientes',  icon: Users },
  { href: '/dashboard/finances', label: 'Finanzas',  icon: DollarSign },
  { href: '/dashboard/reports',  label: 'Reportes',  icon: BarChart3 },
  { href: '/dashboard/settings', label: 'Ajustes',   icon: Settings },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
  user?: any
  business?: any
}

export function Sidebar({ open = true, onClose, user, business }: SidebarProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile overlay */}
      {onClose && open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full w-64 flex-col bg-card border-r border-border',
          'transition-transform duration-300 ease-in-out',
          'flex flex-col',
          // Mobile: slide in/out
          open ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible
          'lg:translate-x-0 lg:static lg:z-auto',
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 shadow-brand-md">
              <Scissors size={18} className="text-white rotate-45" />
            </div>
            <div>
              <span className="text-lg font-bold text-foreground tracking-tight">Agendo</span>
              <p className="text-[10px] text-brand-600 font-medium -mt-0.5">Pro Plan</p>
            </div>
          </Link>
          {/* Mobile close button */}
          {onClose && (
            <button className="btn-ghost p-1 lg:hidden" onClick={onClose} aria-label="Cerrar menú">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Business info */}
        {business && (
          <div className="px-4 py-3 mx-3 mt-3 rounded-2xl bg-brand-50 dark:bg-brand-900/20">
            <p className="text-xs text-muted-foreground font-medium">Negocio activo</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{business.name}</p>
            <p className="text-xs text-muted-foreground">{business.category || 'Servicios'}</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Principal
          </p>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'nav-item group',
                  isActive ? 'nav-item-active' : 'nav-item-inactive'
                )}
              >
                <Icon size={18} className={cn(
                  'flex-shrink-0 transition-colors',
                  isActive ? 'text-brand-600' : 'text-muted-foreground group-hover:text-foreground'
                )} />
                <span className="flex-1">{item.label}</span>
                {isActive && <ChevronRight size={14} className="text-brand-600 opacity-60" />}
              </Link>
            )
          })}
        </nav>

        {/* User profile at bottom */}
        {user && (
          <div className="px-3 py-4 border-t border-border">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: user.color || '#F0FDF4', color: user.color ? '#FFF' : '#16a34a' }}>
                {user.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
