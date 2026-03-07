import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isTomorrow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

// ── Tailwind className merger ─────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Date Formatters ───────────────────────────────────────
export function formatDate(date: string | Date, fmt = 'd MMM yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, fmt, { locale: es })
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'HH:mm', { locale: es })
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  if (isToday(d)) return `Hoy, ${formatTime(d)}`
  if (isTomorrow(d)) return `Mañana, ${formatTime(d)}`
  return formatDistanceToNow(d, { addSuffix: true, locale: es })
}

export function formatCurrency(amount: number, currency = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// ── String Helpers ────────────────────────────────────────
export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Status Helpers ────────────────────────────────────────
import type { AppointmentStatus } from '@/types'

export const appointmentStatusConfig: Record<
  AppointmentStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  pending: {
    label: 'Pendiente',
    color: 'text-orange-700 dark:text-orange-400',
    bg:    'bg-orange-100 dark:bg-orange-900/30',
    dot:   'bg-orange-500',
  },
  confirmed: {
    label: 'Confirmada',
    color: 'text-green-700 dark:text-green-400',
    bg:    'bg-green-100 dark:bg-green-900/30',
    dot:   'bg-green-500',
  },
  completed: {
    label: 'Completada',
    color: 'text-gray-600 dark:text-gray-400',
    bg:    'bg-gray-100 dark:bg-gray-800/50',
    dot:   'bg-gray-500',
  },
  cancelled: {
    label: 'Cancelada',
    color: 'text-red-700 dark:text-red-400',
    bg:    'bg-red-100 dark:bg-red-900/30',
    dot:   'bg-red-500',
  },
  no_show: {
    label: 'No se presentó',
    color: 'text-purple-700 dark:text-purple-400',
    bg:    'bg-purple-100 dark:bg-purple-900/30',
    dot:   'bg-purple-500',
  },
}

export const paymentMethodLabels: Record<string, string> = {
  cash:     'Efectivo',
  card:     'Tarjeta',
  transfer: 'Transferencia',
  qr:       'QR / Nequi',
  other:    'Otro',
}

export const expenseCategoryLabels: Record<string, string> = {
  supplies:  'Insumos',
  rent:      'Arriendo',
  utilities: 'Servicios',
  payroll:   'Nómina',
  marketing: 'Marketing',
  equipment: 'Equipos',
  other:     'Otro',
}
