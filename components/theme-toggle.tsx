'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1">
      {(['light', 'system', 'dark'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={cn(
            'rounded-lg p-1.5 transition-all duration-150',
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
