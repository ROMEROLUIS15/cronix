import * as React from 'react'
import { cn } from '@/lib/utils'
import type { AppointmentStatus } from '@/types'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'dual'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  warning: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  danger:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  info:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  brand:   'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 ring-1 ring-brand-300/50',
  dual:    'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-400 ring-1 ring-brand-300/50',
}

export function Badge({ variant = 'default', dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn('badge', variantClasses[variant], className)}
      {...props}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', {
          'bg-green-500':  variant === 'success',
          'bg-yellow-500': variant === 'warning',
          'bg-red-500':    variant === 'danger',
          'bg-blue-500':   variant === 'info',
          'bg-brand-600':  variant === 'brand' || variant === 'dual',
          'bg-gray-500':   variant === 'default',
        })} />
      )}
      {children}
    </span>
  )
}

// Appointment status badge with semantic colors
const statusVariant: Record<AppointmentStatus, BadgeVariant> = {
  pending:   'warning',
  confirmed: 'success',
  completed: 'default',
  cancelled: 'danger',
  no_show:   'danger',
}

const statusLabel: Record<AppointmentStatus, string> = {
  pending:   'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show:   'No asistió',
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <Badge variant={statusVariant[status]} dot>
      {statusLabel[status]}
    </Badge>
  )
}

// Dual booking star badge
export function DualBookingBadge() {
  return (
    <Badge variant="dual">
      ⭐ Doble cita
    </Badge>
  )
}
