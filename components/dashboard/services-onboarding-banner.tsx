'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Wrench, X, ArrowRight, Sparkles } from 'lucide-react'

interface Props {
  businessId: string
  hasServices?: boolean
}

/**
 * Banner shown when a business has no services configured.
 * Now receives `hasServices` as prop — no Supabase import needed.
 * Falls back to showing the banner if `hasServices` is undefined (backward compat).
 */
export function ServicesOnboardingBanner({ businessId, hasServices }: Props) {
  const t = useTranslations('services.onboarding')
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    return !!localStorage.getItem(`services-banner-${businessId}`)
  })

  // If parent tells us there ARE services, don't show
  if (hasServices || dismissed) return null

  const dismiss = () => {
    localStorage.setItem(`services-banner-${businessId}`, '1')
    setDismissed(true)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-indigo-50 dark:from-brand-900/20 dark:to-indigo-900/20 dark:border-brand-800/30 p-5">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
          <Wrench size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-foreground">{t('title')}</h3>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full">
              <Sparkles size={10} /> {t('badge')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t('desc')}
          </p>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/services"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-xl transition-colors">
              {t('cta')} <ArrowRight size={13} />
            </Link>
            <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('later')}
            </button>
          </div>
        </div>
        <button onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}