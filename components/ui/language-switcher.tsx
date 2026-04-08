'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
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
  const searchParams = useSearchParams()
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
      const query = searchParams.toString();
      const newPath = query ? `${pathname}?${query}` : pathname;
      router.replace(newPath, { locale: next })
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300 hover:bg-white/10 active:scale-95 select-none group"
        style={{
          color: isPending ? '#4D83FF' : '#F2F2F2',
          border: open || isPending ? '1px solid rgba(0, 98, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
          backgroundColor: open || isPending ? 'rgba(0, 98, 255, 0.1)' : 'rgba(255, 255, 255, 0.03)',
          boxShadow: open || isPending ? '0 0 15px rgba(0, 98, 255, 0.15)' : 'none',
        }}
      >
        <Globe 
          size={14} 
          className={`transition-all duration-300 ${isPending ? 'animate-spin text-[#4D83FF]' : 'group-hover:rotate-12'} ${open ? 'text-[#4D83FF]' : ''}`} 
        />
        <span className={`text-[10px] font-black uppercase tracking-widest hidden sm:inline ${isPending ? 'animate-pulse' : ''}`}>
          {locale}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label={t('label')}
          className="absolute right-0 mt-3 w-44 rounded-2xl overflow-hidden border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50 animate-slide-up"
          style={{ 
            backgroundColor: 'rgba(22, 22, 26, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)'
          }}
        >
          <div className="p-1.5 space-y-0.5">
            {routing.locales.map((loc) => {
              const isSelected = loc === locale
              return (
                <button
                  key={loc}
                  role="option"
                  aria-selected={isSelected}
                  type="button"
                  onClick={() => switchLocale(loc)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] transition-all duration-200 group"
                  style={{
                    color: isSelected ? '#F2F2F2' : '#909098',
                    backgroundColor: isSelected ? 'rgba(0, 98, 255, 0.15)' : 'transparent',
                  }}
                >
                  <span className="text-lg transition-transform duration-200 group-hover:scale-125">
                    {LOCALE_FLAGS[loc]}
                  </span>
                  <span className={`flex-1 text-left ${isSelected ? 'font-bold' : 'font-medium'}`}>
                    {t(loc)}
                  </span>
                  {isSelected && (
                    <div className="flex items-center justify-center h-5 w-5 rounded-full bg-[#0062FF]/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#0062FF]" 
                           style={{ boxShadow: '0 0 8px #0062FF' }} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
