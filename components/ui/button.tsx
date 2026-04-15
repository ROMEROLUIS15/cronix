'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  className?: string
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:   'bg-[hsl(var(--primary))] hover:brightness-110 active:brightness-90 text-white shadow-brand-sm transition-all',
  secondary: 'bg-surface hover:bg-[rgba(var(--primary-rgb),0.08)] text-foreground border border-border hover:border-[rgba(var(--primary-rgb),0.4)] transition-all',
  ghost:     'text-muted-foreground hover:text-foreground hover:bg-muted',
  danger:    'bg-danger hover:bg-danger/90 text-white shadow-sm',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm:  'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md:  'px-5 py-2.5 text-sm rounded-xl gap-2',
  lg:  'px-6 py-3 text-base rounded-xl gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
}
