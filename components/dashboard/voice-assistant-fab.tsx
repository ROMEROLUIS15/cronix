'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Mic } from 'lucide-react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import type { BusinessSettingsJson } from '@/types'
import { VoiceVisualizer } from './voice-visualizer'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function VoiceAssistantFab() {
  const t = useTranslations('voiceAssistant')
  const { supabase, businessId } = useBusinessContext()
  const queryClient = useQueryClient()
  const [state, setState] = useState<AssistantState>('idle')
  const [chatHistory, setChatHistory] = useState<{role: string, content: string}[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = sessionStorage.getItem('cronix-assistant-history')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [isLoaded, setIsLoaded] = useState(false)
  const [showLuisFab, setShowLuisFab] = useState(true)

  // Keep server-side conversation context in sync
  useEffect(() => {
    if (chatHistory.length > 0) {
      sessionStorage.setItem('cronix-assistant-history', JSON.stringify(chatHistory))
    }
  }, [chatHistory])

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

  const mediaRecorderRef   = useRef<MediaRecorder | null>(null)
  const audioContextRef    = useRef<AudioContext | null>(null)
  const analyserRef        = useRef<AnalyserNode | null>(null)
  const silenceTimerRef    = useRef<NodeJS.Timeout | null>(null)
  const rafIdRef           = useRef<number | null>(null)
  const hasSpokenRef       = useRef<boolean>(false)
  const currentAudioRef    = useRef<HTMLAudioElement | null>(null)
  const audioChunksRef     = useRef<Blob[]>([])
  const pollingTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleCheckRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const onlineListenerRef  = useRef<(() => void) | null>(null)
  const currentJobIdRef    = useRef<string | null>(null)
  const [volume, setVolume] = useState(0)

  // ── Fetch with client-side timeout ───────────────────────────────────────
  const FETCH_TIMEOUT_MS = 45_000
  const fetchWithTimeout = (url: string, opts: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer))
  }

  // ── Play audio URL — silent on error (Deepgram-only, no browser TTS fallback) ──
  const playAudio = async (src: string, _fallbackText?: string) => {
    return new Promise<void>((resolve) => {
      const audio = new Audio(src)
      currentAudioRef.current = audio
      audio.onended = () => { setState('idle'); resolve() }
      audio.onerror = () => { setState('idle'); resolve() }
      audio.play().catch(() => { setState('idle'); resolve() })
    })
  }

  // ── Vocalize error via Deepgram TTS endpoint — silent if that also fails ─
  const vocalizeSilentFailsafe = (msg: string) => {
    setState('speaking')
    const audio = new Audio(`/api/assistant/tts?t=${encodeURIComponent(msg.slice(0, 500))}`)
    currentAudioRef.current = audio
    audio.onended = () => setState('idle')
    audio.onerror = () => setState('idle')
    audio.play().catch(() => setState('idle'))
  }

  // ── Polling: stop + cleanup ───────────────────────────────────────────────
  const stopPolling = () => {
    if (pollingTimerRef.current)   { clearTimeout(pollingTimerRef.current);   pollingTimerRef.current  = null }
    if (idleCheckRef.current)      { clearInterval(idleCheckRef.current);      idleCheckRef.current     = null }
    if (onlineListenerRef.current) {
      window.removeEventListener('online', onlineListenerRef.current)
      onlineListenerRef.current = null
    }
    currentJobIdRef.current = null
    try { sessionStorage.removeItem('cronix-active-job') } catch { /* ignore */ }
  }

  // ── Handle completed job result ───────────────────────────────────────────
  const handleJobResult = async (data: {
    text?: string
    audioUrl?: string | null
    actionPerformed?: boolean
    history?: { role: string; content: string }[]
  }) => {
    if (data.actionPerformed) {
      void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', businessId] })
    }
    if (data.history) setChatHistory(data.history.slice(-15))

    setState('speaking')

    if (data.audioUrl) {
      await playAudio(data.audioUrl, data.text ?? '')
    } else if (data.text) {
      await playAudio(`/api/assistant/tts?t=${encodeURIComponent(data.text.slice(0, 500))}`, data.text)
    } else {
      vocalizeSilentFailsafe(
        data.actionPerformed ? 'Listo.' : 'No recibí respuesta. Por favor intenta de nuevo.'
      )
    }
  }

  // ── Polling: start (resilient to network blinks) ──────────────────────────
  // - setTimeout recursion with adaptive delay (750ms normal → 2500ms after 3+ errors)
  // - Pauses while offline, fires immediately on 'online' event
  // - Idle timeout measured from LAST successful server contact
  // - Persists job_id in sessionStorage for recovery on page reload
  const startJobPolling = (jobId: string) => {
    stopPolling()
    currentJobIdRef.current = jobId

    try {
      sessionStorage.setItem('cronix-active-job', JSON.stringify({ jobId, startedAt: Date.now() }))
    } catch { /* storage unavailable — polling still works */ }

    let consecutiveErrors = 0
    let lastServerContact = Date.now()
    const isCurrent = () => currentJobIdRef.current === jobId

    const scheduleNext = (delayMs: number) => {
      if (!isCurrent()) return
      pollingTimerRef.current = setTimeout(() => { void doPoll() }, delayMs)
    }

    const doPoll = async () => {
      if (!isCurrent()) return
      if (typeof navigator !== 'undefined' && !navigator.onLine) { scheduleNext(2000); return }

      try {
        const res = await fetch(`/api/assistant/voice/status?job_id=${encodeURIComponent(jobId)}`)
        if (!isCurrent()) return

        if (res.status === 404) {
          stopPolling()
          vocalizeSilentFailsafe('No recibí respuesta del asistente. Por favor intenta de nuevo.')
          return
        }

        if (!res.ok) {
          consecutiveErrors++
          scheduleNext(consecutiveErrors >= 3 ? 2500 : 750)
          return
        }

        consecutiveErrors = 0
        lastServerContact = Date.now()

        const data = await res.json() as {
          status: string
          text?: string
          audioUrl?: string | null
          actionPerformed?: boolean
          history?: { role: string; content: string }[]
        }

        if (data.status === 'completed') {
          stopPolling()
          await handleJobResult(data)
        } else if (data.status === 'failed') {
          stopPolling()
          setState('speaking')
          if (data.audioUrl) {
            await playAudio(data.audioUrl, 'Hubo un problema. Por favor intenta de nuevo.')
          } else {
            vocalizeSilentFailsafe('Hubo un problema al procesar tu solicitud. Por favor intenta de nuevo.')
          }
        } else {
          scheduleNext(750)
        }
      } catch {
        if (!isCurrent()) return
        consecutiveErrors++
        scheduleNext(consecutiveErrors >= 3 ? 2500 : 750)
      }
    }

    const onOnline = () => {
      if (!isCurrent()) return
      consecutiveErrors = 0
      if (pollingTimerRef.current) { clearTimeout(pollingTimerRef.current); pollingTimerRef.current = null }
      void doPoll()
    }
    onlineListenerRef.current = onOnline
    window.addEventListener('online', onOnline)

    // Idle watchdog: 50s from last successful server contact
    idleCheckRef.current = setInterval(() => {
      if (!isCurrent()) return
      if (Date.now() - lastServerContact > 50_000) {
        stopPolling()
        vocalizeSilentFailsafe('El asistente tardó demasiado. Por favor intenta de nuevo.')
      }
    }, 5000)

    void doPoll()
  }

  // ── Send audio blob ───────────────────────────────────────────────────────
  const sendAudioToAssistant = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio',    audioBlob, 'audio.webm')
      formData.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)

      const res = await fetchWithTimeout('/api/assistant/voice', {
        method:  'POST',
        headers: { 'x-request-id': crypto.randomUUID() },
        body:    formData,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        logger.error('VoiceAssistantFab', `API error ${res.status}`, errData)
        const errMsg = res.status === 403 ? 'Sin acceso al asistente.'
                     : res.status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
                     : (errData as { error?: string }).error || 'Error al contactar a Luis.'
        vocalizeSilentFailsafe(errMsg)
        return
      }

      const data = await res.json() as { job_id: string; status: string }

      // Audible confirmation — fire-and-forget, does not affect polling
      new Audio(`/api/assistant/tts?t=${encodeURIComponent('Procesando tu solicitud...')}`).play().catch(() => {})

      startJobPolling(data.job_id)

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        vocalizeSilentFailsafe('Tiempo de espera agotado. Intenta de nuevo.')
        return
      }
      logger.error('VoiceAssistantFab', 'Network error contacting assistant', err)
      vocalizeSilentFailsafe('Error de red. Intenta de nuevo.')
    }
  }

  // ── Send text ─────────────────────────────────────────────────────────────
  const sendTextToAssistant = async (text: string) => {
    try {
      const res = await fetchWithTimeout('/api/assistant/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
        body:    JSON.stringify({ text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const errMsg = res.status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
                     : (errData as { error?: string }).error || 'Error al conectar con Luis.'
        vocalizeSilentFailsafe(errMsg)
        return
      }

      const data = await res.json() as { job_id: string; status: string }

      new Audio(`/api/assistant/tts?t=${encodeURIComponent('Procesando tu solicitud...')}`).play().catch(() => {})

      startJobPolling(data.job_id)

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        vocalizeSilentFailsafe('Tiempo de espera agotado. Intenta de nuevo.')
        return
      }
      logger.error('VoiceAssistantFab', 'Error sending text to assistant', err)
      vocalizeSilentFailsafe('Error de red. Intenta de nuevo.')
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      vocalizeSilentFailsafe('Micrófono no disponible en este navegador.')
      return
    }
    const mimeType = getSupportedMimeType()
    if (!mimeType) {
      vocalizeSilentFailsafe('Tu navegador no soporta grabación de audio.')
      return
    }

    setState('listening')
    setVolume(0)
    audioChunksRef.current = []
    hasSpokenRef.current   = false

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as DOMException).name : ''
      const msg  = err instanceof Error ? err.message : String(err)
      logger.error('VoiceAssistantFab', 'Microphone access failed', { name, msg })
      setState('idle')

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        vocalizeSilentFailsafe('Necesito permiso para el micrófono. Actívalo en la configuración del navegador.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        vocalizeSilentFailsafe('No se detectó ningún micrófono conectado.')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        vocalizeSilentFailsafe('El micrófono está siendo usado por otra aplicación.')
      } else {
        vocalizeSilentFailsafe('No se pudo acceder al micrófono.')
      }
      return
    }

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const audioContext = audioContextRef.current
      if (audioContext.state === 'suspended') await audioContext.resume()

      const analyser = audioContext.createAnalyser()
      analyser.fftSize              = 512
      analyser.smoothingTimeConstant = 0.2
      audioContext.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        setState('processing')
        stream.getTracks().forEach(t => t.stop())

        if (!hasSpokenRef.current || audioChunksRef.current.length === 0) {
          setState('idle')
          return
        }

        await sendAudioToAssistant(new Blob(audioChunksRef.current, { type: mimeType }))
      }

      mediaRecorder.start(250)

      // VAD — RMS-based voice activity detection with adaptive noise floor
      const MIN_RMS_FLOOR    = 5
      const SILENCE_DURATION = 600
      const MAX_WAIT_MS      = 8000
      const startTime        = Date.now()
      const tdArray          = new Uint8Array(analyser.fftSize)

      let calibrated              = false
      let noiseFloor              = MIN_RMS_FLOOR
      const noiseFloorSamples: number[] = []

      const monitor = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return

        analyser.getByteTimeDomainData(tdArray)
        const rms = Math.sqrt(tdArray.reduce((sum, v) => sum + (v - 128) ** 2, 0) / tdArray.length)
        setVolume(Math.min((rms / 128) * 5, 1))

        const elapsed = Date.now() - startTime

        if (!calibrated) {
          noiseFloorSamples.push(rms)
          if (elapsed >= 400) {
            const avg = noiseFloorSamples.reduce((a, b) => a + b, 0) / noiseFloorSamples.length
            noiseFloor = Math.max(MIN_RMS_FLOOR, avg * 2.5)
            calibrated = true
          }
          rafIdRef.current = requestAnimationFrame(monitor)
          return
        }

        if (!hasSpokenRef.current) {
          if (rms > noiseFloor) {
            hasSpokenRef.current = true
          } else if (elapsed > MAX_WAIT_MS) {
            stopRecording()
            return
          }
        } else {
          if (rms < noiseFloor * 0.7) {
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => stopRecording(), SILENCE_DURATION)
            }
          } else if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        }

        rafIdRef.current = requestAnimationFrame(monitor)
      }
      monitor()

    } catch (err: unknown) {
      logger.error('VoiceAssistantFab', 'Recording setup failed', err)
      stream.getTracks().forEach(t => t.stop())
      setState('idle')
      vocalizeSilentFailsafe('Error al iniciar la grabación.')
    }
  }

  const stopRecording = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (rafIdRef.current)        { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const handleClick = () => {
    if (state === 'speaking') {
      currentAudioRef.current?.pause()
      currentAudioRef.current = null
      setState('idle')
      return
    }
    if (state === 'processing') {
      stopPolling()
      setState('idle')
      return
    }
    if (state === 'idle')      startRecording()
    if (state === 'listening') stopRecording()
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recovery: resume polling after page reload if a job was in-flight
  useEffect(() => {
    if (!isLoaded) return
    try {
      const saved = sessionStorage.getItem('cronix-active-job')
      if (!saved) return
      const { jobId, startedAt } = JSON.parse(saved) as { jobId: string; startedAt: number }
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        sessionStorage.removeItem('cronix-active-job')
        return
      }
      setState('processing')
      startJobPolling(jobId)
    } catch { /* ignore corrupt sessionStorage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded])

  // Safety timeout: 30 min max in processing/speaking (matches session TTL)
  useEffect(() => {
    if (state !== 'speaking' && state !== 'processing') return
    const timer = setTimeout(() => { stopPolling(); setState('idle') }, 30 * 60 * 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

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
          aria-label="Abrir asistente de voz Luis IA"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title="Luis IA — Arrastra para mover"
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
          {state === 'listening'  && <VoiceVisualizer isActive volume={volume} isSpeaking={false} />}
          {state === 'processing' && <VoiceVisualizer isActive volume={0.15} isSpeaking={false} />}
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
          aria-label="Abrir asistente de voz Luis IA"
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
            ? <VoiceVisualizer isActive volume={volume} isSpeaking={false} />
            : state === 'processing'
            ? <VoiceVisualizer isActive volume={0.15} isSpeaking={false} />
            : <VoiceVisualizer isActive volume={0.5} isSpeaking />
          }
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${state === 'idle' ? 'bg-[#3884FF]' : 'bg-white animate-pulse'}`} />
        </button>
      </motion.div>
    </>
  )
}
