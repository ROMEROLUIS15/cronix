'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  CalendarDays, Users, DollarSign, BarChart3,
  Settings, ChevronRight, Scissors, X, LogOut, Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signout } from '@/app/login/actions'

const navItems = [
  { href: '/dashboard',          label: 'Agenda',    icon: CalendarDays },
  { href: '/dashboard/clients',  label: 'Clientes',  icon: Users },
  { href: '/dashboard/services', label: 'Servicios', icon: Wrench },
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

  const initials = user?.name
    ?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U'

  return (
    <>
      {onClose && open && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside className={cn(
        'fixed top-0 left-0 z-40 h-full w-64 bg-card border-r border-border',
        'transition-transform duration-300 ease-in-out flex flex-col',
        open ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0 lg:static lg:z-auto',
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-6 border-b border-border/50">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 shadow-brand-lg transition-transform hover:scale-105 active:scale-95">
              <Scissors size={20} className="text-white rotate-45" />
            </div>
            <div>
              <span className="text-xl font-extrabold text-foreground tracking-tight">Agendo</span>
              <p className="text-[10px] text-brand-600 font-bold tracking-wider uppercase -mt-1">Premium</p>
            </div>
          </Link>
          {onClose && (
            <button className="btn-ghost p-1.5 lg:hidden text-muted-foreground hover:text-foreground"
              onClick={onClose} aria-label="Cerrar menú">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Business info */}
        {business && (
          <div className="px-4 py-4 mx-4 mt-6 rounded-2xl bg-brand-50/50 dark:bg-brand-900/10 border border-brand-100/50 dark:border-brand-800/10">
            <p className="text-[10px] text-brand-600 font-extrabold uppercase tracking-widest mb-1.5 opacity-80">
              Negocio activo
            </p>
            <p className="text-sm font-bold text-foreground leading-tight">{business.name}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              {business.category || 'Servicios'}
            </p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Principal
          </p>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href}
                className={cn('nav-item group', isActive ? 'nav-item-active' : 'nav-item-inactive')}>
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

        {/* User + Logout */}
        {user && (
          <div className="px-3 py-4 border-t border-border mt-auto space-y-2">
            <Link href="/dashboard/profile"
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface hover:bg-brand-50/50 transition-colors group',
                pathname === '/dashboard/profile' && 'ring-1 ring-brand-600 bg-brand-50'
              )}>
              {/* Avatar — foto si existe, iniciales si no */}
              <div className="h-9 w-9 rounded-full flex-shrink-0 overflow-hidden border border-border">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.name ?? 'Avatar'}
                    width={36} height={36}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs font-bold"
                    style={{ backgroundColor: user.color || '#F0FDF4', color: user.color ? '#FFF' : '#16a34a' }}>
                    {initials}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate group-hover:text-brand-600">
                  {user.name}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{user.role}</p>
              </div>
            </Link>

            <form action={signout}>
              <button type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/10 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl transition-all active:scale-[0.98]">
                <LogOut size={14} />
                Cerrar sesión
              </button>
            </form>
          </div>
        )}
      </aside>
    </>
  )
}