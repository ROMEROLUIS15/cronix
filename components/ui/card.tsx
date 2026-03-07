import * as React from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined'
  interactive?: boolean
}

export function Card({ variant = 'default', interactive = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'card-base',
        variant === 'elevated' && 'shadow-brand-md',
        variant === 'outlined' && 'shadow-none',
        interactive && 'cursor-pointer hover:shadow-brand-sm hover:-translate-y-0.5 transition-all duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold text-foreground', className)} {...props}>
      {children}
    </h3>
  )
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('', className)} {...props}>
      {children}
    </div>
  )
}

// Stat card for dashboard KPIs
interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  trend?: { value: number; label: string }
  accent?: boolean
}

export function StatCard({ title, value, subtitle, icon, trend, accent = false }: StatCardProps) {
  return (
    <Card
      className={cn(
        accent && 'bg-brand-600 text-white border-brand-700',
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={cn('text-sm font-medium', accent ? 'text-brand-100' : 'text-muted-foreground')}>
            {title}
          </p>
          <p className={cn('text-3xl font-bold mt-1', accent ? 'text-white' : 'text-foreground')}>
            {value}
          </p>
          {subtitle && (
            <p className={cn('text-xs mt-1', accent ? 'text-brand-200' : 'text-muted-foreground')}>
              {subtitle}
            </p>
          )}
          {trend && (
            <p className={cn('text-xs mt-2 flex items-center gap-1',
              trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
              accent && 'text-brand-200'
            )}>
              <span>{trend.value >= 0 ? '↑' : '↓'}</span>
              <span>{Math.abs(trend.value)}% {trend.label}</span>
            </p>
          )}
        </div>
        {icon && (
          <div className={cn(
            'flex h-12 w-12 items-center justify-center rounded-2xl',
            accent ? 'bg-brand-500/50 text-white' : 'bg-brand-50 dark:bg-brand-900/30 text-brand-600'
          )}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}
