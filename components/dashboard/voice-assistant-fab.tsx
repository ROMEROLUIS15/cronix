'use client'

import React from 'react'
import { Mic } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import { VoiceVisualizer } from './voice-visualizer'
import { useFabChrome } from './use-fab-chrome'
import { useRealtimeDashboardSync } from './use-realtime-dashboard-sync'
import { useVoiceAssistant } from './use-voice-assistant'

/**
 * VoiceAssistantFab — presentational shell for the "Luis" voice assistant.
 *
 * All behaviour lives in three hooks so the component stays a dumb view:
 *   - useVoiceAssistant       → recording / STT / voice-worker / TTS playback
 *   - useFabChrome            → drag persistence + visibility preference
 *   - useRealtimeDashboardSync → React Query invalidation on DB changes
 *
 * Memoized: it takes no props, so it never needs to re-render when the dashboard
 * around it does.
 */
export const VoiceAssistantFab = React.memo(function VoiceAssistantFab() {
  const t = useTranslations('voiceAssistant')
  const { supabase, businessId } = useBusinessContext()
  const queryClient = useQueryClient()

  const { showLuisFab, isLoaded, y, yDesktop, springY, springYDesktop } = useFabChrome(businessId, supabase)
  useRealtimeDashboardSync(businessId, supabase, queryClient)
  const { state, volume, handleClick } = useVoiceAssistant(supabase, queryClient)

  if (typeof window === 'undefined' || !isLoaded || !showLuisFab) return null

  // ── Visual states ─────────────────────────────────────────────────────────
  // idle:       Mic icon
  // listening:  Waves reacting to voice input (volume-driven)
  // processing: Slow ambient pulse — "system is thinking"
  // speaking:   Waves animated at fixed amplitude

  return (
    <>
      {/* ── MOBILE: Draggable circle ────────────────────────────────────── */}
      <motion.div
        drag="y"
        dragConstraints={{ top: -(window.innerHeight - 150), bottom: 20 }}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={() => localStorage.setItem('cronix-assistant-y', y.get().toString())}
        style={{ y: springY }}
        className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 sm:hidden touch-none"
      >
        <motion.button
          whileTap={{ scale: 0.9 }}
          type="button"
          data-testid="voice-assistant-fab-mobile"
          aria-label={t('openAria')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title={t('dragTitle')}
          className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-all duration-300"
          style={
            state === 'listening'
              ? { background: '#09090b', border: '2px solid rgba(168,85,247,0.8)', boxShadow: '0 0 28px rgba(168,85,247,0.5)' }
              : state === 'processing'
              ? { background: '#09090b', border: '2px solid rgba(56,132,255,0.4)', boxShadow: '0 0 16px rgba(56,132,255,0.25)' }
              : state === 'speaking'
              ? { background: '#09090b', border: '2px solid rgba(56,132,255,0.8)', boxShadow: '0 0 26px rgba(56,132,255,0.5)' }
              : { background: '#09090b', border: '2px solid rgba(56,132,255,0.7)', boxShadow: '0 0 18px rgba(56,132,255,0.4)' }
          }
        >
          {state === 'idle'       && <Mic className="w-6 h-6" style={{ color: '#3884FF' }} />}
          {state === 'listening'  && <VoiceVisualizer isActive volume={Math.max(volume, 0.25)} isSpeaking={false} />}
          {state === 'processing' && <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
          {state === 'speaking'   && <VoiceVisualizer isActive volume={0.5} isSpeaking />}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-zinc-700 rounded-full opacity-30" />
        </motion.button>
      </motion.div>

      {/* ── DESKTOP: Draggable pill ─────────────────────────────────────── */}
      <motion.div
        drag="y"
        dragConstraints={{ top: -(window.innerHeight - 150), bottom: window.innerHeight - 150 }}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={() => localStorage.setItem('cronix-assistant-y-desktop', yDesktop.get().toString())}
        style={{ y: springYDesktop }}
        className="hidden sm:flex fixed top-[72px] right-6 z-50 flex-col items-end gap-3 touch-none"
      >
        <button
          type="button"
          data-testid="voice-assistant-fab"
          aria-label={t('openAria')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title={t('fabTitle')}
          className={`relative flex items-center gap-2.5 h-10 px-4 rounded-full transition-all duration-300 font-semibold text-sm select-none ${
            state === 'idle' ? 'hover:scale-105' : state === 'listening' ? 'scale-105' : ''
          }`}
          style={
            state === 'listening'
              ? { background: 'rgba(5,5,10,0.9)', border: '1.5px solid rgba(168,85,247,0.8)', boxShadow: '0 0 22px rgba(168,85,247,0.45)', backdropFilter: 'blur(12px)' }
              : state === 'processing'
              ? { background: 'rgba(5,5,10,0.9)', border: '1.5px solid rgba(56,132,255,0.35)', boxShadow: '0 0 12px rgba(56,132,255,0.2)', backdropFilter: 'blur(12px)' }
              : state === 'speaking'
              ? { background: 'rgba(5,5,10,0.9)', border: '1.5px solid rgba(56,132,255,0.8)', boxShadow: '0 0 22px rgba(56,132,255,0.4)', backdropFilter: 'blur(12px)' }
              : { background: 'rgba(5,5,10,0.85)', color: '#3884FF', border: '1.5px solid rgba(56,132,255,0.55)', boxShadow: '0 0 18px rgba(56,132,255,0.25)', backdropFilter: 'blur(12px)' }
          }
        >
          {state === 'idle'
            ? <Mic className="w-4 h-4 flex-shrink-0" style={{ color: '#3884FF' }} />
            : state === 'listening'
            ? <VoiceVisualizer isActive volume={Math.max(volume, 0.25)} isSpeaking={false} />
            : state === 'processing'
            ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin flex-shrink-0" />
            : <VoiceVisualizer isActive volume={0.5} isSpeaking />
          }
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${state === 'idle' ? 'bg-[#3884FF]' : 'bg-white animate-pulse'}`} />
        </button>
      </motion.div>
    </>
  )
})
