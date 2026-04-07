'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { routing, type Locale } from '@/i18n/routing'
import { Globe } from 'lucide-react'
import { useTransition, useState, useRef, useEffect } from 'react'

// ── Flag mapping ───────────────────────────────────────────────────────────────
const LOCALE_FLAGS: Record<Locale, string> = {
  es: '🇪🇸',
  en: '🇬🇧',
  pt: '🇧🇷',
  fr: '🇫🇷',
  de: '🇩🇪',
  it: '🇮🇹',
}

export function LanguageSwitcher() {
  const t = useTranslations('languageSwitcher')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function switchLocale(next: Locale) {
    setOpen(false)
    startTransition(() => {
      router.replace(pathname, { locale: next })
    })
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-label={t('label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-200 hover:bg-white/5 active:scale-95 select-none"
        style={{
          color: isPending ? '#505058' : '#909098',
          border: '1px solid #2E2E33',
          backgroundColor: open ? 'rgba(255,255,255,0.05)' : 'transparent',
        }}
      >
        <Globe size={15} className={isPending ? 'animate-spin' : ''} />
        <span className="text-[11px] font-bold uppercase tracking-wider hidden sm:inline">
          {locale}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label={t('label')}
          className="absolute right-0 mt-2 w-40 rounded-2xl overflow-hidden border border-[#2E2E33] shadow-2xl z-50"
          style={{ backgroundColor: '#1A1A1F', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}
        >
          {routing.locales.map((loc) => {
            const isSelected = loc === locale
            return (
              <button
                key={loc}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => switchLocale(loc)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                style={{
                  color: isSelected ? '#F2F2F2' : '#909098',
                  fontWeight: isSelected ? 700 : 400,
                  backgroundColor: isSelected ? 'rgba(0,98,255,0.08)' : 'transparent',
                }}
              >
                <span className="text-base">{LOCALE_FLAGS[loc]}</span>
                <span className="flex-1 text-left">{t(loc)}</span>
                {isSelected && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#0062FF' }} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
