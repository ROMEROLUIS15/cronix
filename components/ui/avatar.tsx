import * as React from 'react'
import { getInitials, cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string | null
  color?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
}

export function Avatar({ name, src, color, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name)
  const bgColor  = color ?? '#EA580C'

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover ring-2 ring-border', sizeClasses[size], className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full font-semibold text-white select-none ring-2 ring-border',
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: bgColor }}
      title={name}
    >
      {initials}
    </div>
  )
}

// Avatar group for stacked display
export function AvatarGroup({
  users,
  max = 3,
}: {
  users: Array<{ name: string; color?: string; src?: string | null }>
  max?: number
}) {
  const visible = users.slice(0, max)
  const overflow = users.length - max

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((user, i) => (
        <Avatar key={i} name={user.name} src={user.src} color={user.color} size="sm" />
      ))}
      {overflow > 0 && (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-border">
          +{overflow}
        </div>
      )}
    </div>
  )
}
