'use client'

import { useState, useEffect } from 'react'
import { useMotionValue, useSpring, type MotionValue } from 'framer-motion'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import type { BusinessSettingsJson } from '@/types'

export interface FabChrome {
  readonly showLuisFab: boolean
  readonly isLoaded: boolean
  readonly y: MotionValue<number>
  readonly yDesktop: MotionValue<number>
  readonly springY: MotionValue<number>
  readonly springYDesktop: MotionValue<number>
}

/**
 * useFabChrome — the FAB's non-voice concerns: drag position persistence,
 * owner visibility preference (settings.uiSettings.showLuisFab) and the
 * `cronix:toggle-fab` window event. Extracted verbatim from VoiceAssistantFab.
 */
export function useFabChrome(businessId: string | null, supabase: SupabaseClient): FabChrome {
  const [isLoaded, setIsLoaded] = useState(false)
  const [showLuisFab, setShowLuisFab] = useState(true)

  // ── Drag & Persistence ──────────────────────────────────────────────────
  const y         = useMotionValue(0)
  const yDesktop  = useMotionValue(0)
  const springY        = useSpring(y,        { stiffness: 300, damping: 30 })
  const springYDesktop = useSpring(yDesktop, { stiffness: 300, damping: 30 })

  useEffect(() => {
    const savedY = localStorage.getItem('cronix-assistant-y')
    if (savedY) y.set(parseFloat(savedY))

    const savedYDesktop = localStorage.getItem('cronix-assistant-y-desktop')
    if (savedYDesktop) yDesktop.set(parseFloat(savedYDesktop))

    if (businessId) {
      const syncVisibility = async () => {
        try {
          const { data } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
          const ui = (data?.settings as unknown as BusinessSettingsJson)?.uiSettings
          if (ui?.showLuisFab === false) setShowLuisFab(false)
        } catch (error) {
          logger.error('VoiceAssistantFab', 'Visibility sync failed', error)
        } finally {
          setIsLoaded(true)
        }
      }
      syncVisibility()
    } else {
      setIsLoaded(true)
    }

    const handleToggle = (e: CustomEvent) => setShowLuisFab(e.detail)
    window.addEventListener('cronix:toggle-fab', handleToggle as EventListener)
    return () => window.removeEventListener('cronix:toggle-fab', handleToggle as EventListener)
  }, [y, yDesktop, businessId, supabase])

  return { showLuisFab, isLoaded, y, yDesktop, springY, springYDesktop }
}
