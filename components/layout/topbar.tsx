'use client'

import { Menu, Bell, Search } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

interface TopbarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  onMenuClick?: () => void
  user?: any
}

export function Topbar({ title, subtitle, actions, onMenuClick, user }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-md px-6">
      {/* Mobile menu button */}
      <button
        className="btn-ghost p-2 lg:hidden"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <Menu size={20} />
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold text-foreground truncate">{title}</h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {actions}

        {/* Notifications */}
        <button
          className="btn-ghost p-2 relative"
          aria-label="Notificaciones"
        >
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-600" />
        </button>

        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}
