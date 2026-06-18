'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Clock, X, ArrowRight, AlertCircle } from 'lucide-react'
import { getBrowserContainer } from '@/lib/browser-container'
import type { BusinessSettingsJson } from '@/types'

interface Props {
  businessId: string
}

/**
 * Nudge shown when a business is running on the system-default schedule (seeded at
 * signup) instead of the owner's real hours. settings.workingHoursConfirmed === true
 * means the owner set them explicitly (setup or Settings) → no nudge. Until then the
 * WhatsApp/voice agents use the default, which may not match reality, so we ask the
 * owner to confirm. Dismiss is per-session (sessionStorage) so it returns until set.
 */
export function WorkingHoursBanner({ businessId }: Props) {
  const t = useTranslations('dashboard.hoursNudge')
  const [confirmed, setConfirmed] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    return !!sessionStorage.getItem(`hours-nudge-${businessId}`)
  })

  useEffect(() => {
    if (!businessId) return
    let active = true
    ;(async () => {
      const result = await getBrowserContainer().businesses.getById(businessId)
      if (!active) return
      const settings = (result.data?.settings as unknown as BusinessSettingsJson) ?? null
      setConfirmed(settings?.workingHoursConfirmed === true)
    })()
    return () => { active = false }
  }, [businessId])

  // Hide while loading, once confirmed, or after dismissal this session.
  if (confirmed === null || confirmed || dismissed) return null

  const dismiss = () => {
    sessionStorage.setItem(`hours-nudge-${businessId}`, '1')
    setDismissed(true)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 dark:border-amber-800/30 p-5">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
          <Clock size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-foreground">{t('title')}</h3>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              <AlertCircle size={10} /> {t('badge')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t('desc')}
          </p>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/settings"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-xl transition-colors">
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
