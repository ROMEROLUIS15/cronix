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

  // ── Supabase Realtime: invalidate React Query on DB changes ───────────────
  // Any write by the AI assistant (or by another tab/device) triggers an immediate
  // cache invalidation so the calendar and stats update without F5.
  useEffect(() => {
    if (!businessId) return

    const invalidateAppts = () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    }
    const invalidateNotifs = () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (supabase as any)
      .channel(`cronix-realtime-${businessId}`)
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'appointments', filter: `business_id=eq.${businessId}` }, invalidateAppts)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `business_id=eq.${businessId}` }, invalidateNotifs)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [businessId, supabase, queryClient])

  const mediaRecorderRef   = useRef<MediaRecorder | null>(null)
  const audioContextRef    = useRef<AudioContext | null>(null)
  const analyserRef        = useRef<AnalyserNode | null>(null)
  const silenceTimerRef    = useRef<NodeJS.Timeout | null>(null)
  const rafIdRef           = useRef<number | null>(null)
  const hasSpokenRef       = useRef<boolean>(false)
  const currentAudioRef    = useRef<HTMLAudioElement | null>(null)
  const audioChunksRef     = useRef<Blob[]>([])
  const audioUnlockedRef   = useRef<boolean>(false)
  const unlockPrimerRef    = useRef<HTMLAudioElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef     = useRef<any>(null)
  // AbortController for the in-flight Edge Function request — lets us cancel
  // when the user taps to interrupt while we're waiting for the response.
  const inflightAbortRef   = useRef<AbortController | null>(null)
  const [volume, setVolume] = useState(0)

  // ── Audio unlock + reusable element ──────────────────────────────────────
  // iOS/Android strictly require Audio.play() to originate from a user gesture.
  // A NEW Audio element created later (when the polling result arrives 3-40s
  // after the click) is NOT considered unlocked, even if a different element was
  // unlocked during the gesture. The fix is to keep ONE audio element alive
  // for the lifetime of the component and reuse it for every playback by setting
  // its `src` — that element stays unlocked once the user has interacted with it.
  const unlockAudioPlayback = () => {
    if (!unlockPrimerRef.current) {
      try {
        const el = new Audio()
        el.preload  = 'auto'
        el.autoplay = false
        unlockPrimerRef.current = el
      } catch { return }
    }
    if (audioUnlockedRef.current) return
    try {
      const el = unlockPrimerRef.current
      el.muted = true
      el.src   = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhOvUAAAIAADSDuAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV'
      const p = el.play()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          audioUnlockedRef.current = true
          el.pause()
          el.muted = false
        }).catch(() => { /* will retry on next click */ })
      } else {
        audioUnlockedRef.current = true
        el.muted = false
      }
    } catch { /* ignore */ }
  }

  /**
   * Plays `src` on the unlocked audio element. Returns a Promise that resolves
   * when playback ends, errors, or hits the safety timeout. Reuses the same
   * element so iOS/Android keep allowing programmatic playback.
   *
   * Robustness baked in:
   *   - "started playing" check after 1500ms — catches silent autoplay blocks
   *     where neither `play()` rejection nor `onerror` fires (mobile bug)
   *   - hard timeout at 30s — final safety against any event-not-firing edge
   *     case (long data: URLs, browser bugs, etc.)
   *   - all paths converge to a single `finish()` so the caller's promise
   *     ALWAYS resolves
   */
  const playOnUnlockedElement = (src: string, opts: { onEnd?: () => void; onError?: (kind: 'error' | 'timeout' | 'never-started') => void } = {}): void => {
    const el = unlockPrimerRef.current ?? new Audio()
    if (!unlockPrimerRef.current) unlockPrimerRef.current = el

    // Wipe previous handlers — the element is reused across playbacks
    el.onended = null
    el.onerror = null
    el.pause()
    el.muted = false
    el.src   = src

    let settled = false
    let startedPlaying = false
    let hardTimer: ReturnType<typeof setTimeout> | null = null
    let startCheckTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (kind: 'end' | 'error' | 'timeout' | 'never-started') => {
      if (settled) return
      settled = true
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null }
      if (startCheckTimer) { clearTimeout(startCheckTimer); startCheckTimer = null }
      el.onended = null
      el.onerror = null
      el.onplaying = null
      logger.info('VoiceAssistantFab', `Audio playback finished: ${kind}`, {
        startedPlaying,
        srcKind: src.startsWith('data:') ? 'data-url' : 'http',
      })
      // On any non-natural finish, stop the element. Without this a playback
      // declared dead (never-started/timeout) can still buffer in the
      // background and burst out seconds later over the next interaction.
      if (kind !== 'end') { try { el.pause() } catch { /* ignore */ } }
      if (kind === 'end') opts.onEnd?.()
      else                opts.onError?.(kind)
    }

    el.onplaying = () => { startedPlaying = true }
    el.onended   = () => finish('end')
    el.onerror   = () => finish('error')

    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => finish('error'))
    }

    // If after 1.5s the audio never reached "playing" state, treat as failure.
    // This catches mobile autoplay blocks where browsers silently refuse to
    // play but don't fire `error` either. 1.5s is long enough for any normal
    // codec decode + buffer.
    startCheckTimer = setTimeout(() => {
      if (!startedPlaying && !settled) {
        logger.warn('VoiceAssistantFab', 'Audio did not start playing within 1.5s — treating as error')
        finish('never-started')
      }
    }, 1500)

    // Hard cap at 30s — guards against any edge case where neither `ended`
    // nor `error` ever fires (long data URLs, disconnected media, etc.).
    hardTimer = setTimeout(() => {
      logger.warn('VoiceAssistantFab', 'Audio playback hard timeout (30s)')
      finish('timeout')
    }, 30_000)

    currentAudioRef.current = el
  }

  // ── Report a genuinely-silent turn to the server for observability ───────
  // The voice-worker returns audioUrl=null and trace=success, so a TTS playback
  // failure here would otherwise be invisible (the dashboard shows success while
  // the user heard nothing). Fire-and-forget; telemetry must never affect UX.
  const reportTtsFailure = (text: string, reason: string) => {
    try {
      void fetch('/api/assistant/tts-failure', {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify({ text: text.slice(0, 500), reason }),
        keepalive: true,
      }).catch(() => { /* ignore */ })
    } catch { /* ignore */ }
  }

  // ── Fetch the synthesized speech BEFORE playing it ───────────────────────
  // /api/assistant/tts does a full Deepgram synthesis round trip, so its
  // time-to-first-byte regularly exceeded playOnUnlockedElement's 1.5s
  // "did playback start" watchdog — every turn was declared `never-started`
  // while the audio was still being synthesized (the CLIENT_TTS_FAILED
  // `never-started|http=200` epidemic in /dashboard/observability).
  // Downloading to a blob first separates synthesis/network latency (owned by
  // this fetch, with its own timeout) from playback start (owned by the
  // watchdog, now legitimate on a local blob), and yields the real HTTP
  // status without a second synthesis call.
  const fetchTtsObjectUrl = async (
    text: string,
  ): Promise<{ ok: true; url: string } | { ok: false; status: number }> => {
    try {
      const res = await fetch(`/api/assistant/tts?t=${encodeURIComponent(text.slice(0, 500))}`, {
        credentials: 'same-origin',
        cache:       'no-store',
        signal:      AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { ok: false, status: res.status }
      const blob = await res.blob()
      return { ok: true, url: URL.createObjectURL(blob) }
    } catch { return { ok: false, status: 0 } }
  }

  // ── Speak text via the TTS endpoint — last-resort path, reports silence ──
  // Resolves when playback finishes (or the failure is reported) so callers
  // can await the full turn. Any failure here means the user heard nothing:
  //   fetch-failed|http=<status> → endpoint problem (auth / Deepgram / key)
  //   never-started|http=200     → autoplay/decode block on a local blob
  const speakTtsText = (msg: string): Promise<void> => new Promise((resolve) => {
    setState('speaking')
    void fetchTtsObjectUrl(msg).then((fetched) => {
      if (!fetched.ok) {
        setState('idle')
        reportTtsFailure(msg, `fetch-failed|http=${fetched.status}`)
        resolve()
        return
      }
      playOnUnlockedElement(fetched.url, {
        onEnd: () => {
          URL.revokeObjectURL(fetched.url)
          setState('idle')
          resolve()
        },
        onError: (kind) => {
          URL.revokeObjectURL(fetched.url)
          setState('idle')
          reportTtsFailure(msg, `${kind}|http=200`)
          resolve()
        },
      })
    })
  })

  const vocalizeSilentFailsafe = (msg: string) => { void speakTtsText(msg) }

  // ── Play a data: audio URL — on failure, re-speak the text via TTS ───────
  const playAudio = async (src: string, fallbackText?: string) => {
    return new Promise<void>((resolve) => {
      playOnUnlockedElement(src, {
        onEnd:   () => { setState('idle'); resolve() },
        onError: () => {
          void speakTtsText(fallbackText ?? 'No te entendí bien, ¿puedes repetir?').then(resolve)
        },
      })
    })
  }

  // ── Edge Function URL ──────────────────────────────────────────────────────
  // Called directly by the FAB — bypasses Vercel entirely so we get the full
  // 150s Supabase Edge Function timeout instead of Vercel Hobby's 10s cap.
  const VOICE_WORKER_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/voice-worker`

  /**
   * One-shot synchronous call to the voice-worker Edge Function.
   * Sends either an audio Blob (multipart) or plain text (JSON), waits for the
   * full pipeline (STT → LLM → TTS), then plays the resulting audio.
   *
   * No polling, no jobs — the Edge Function returns the final result directly.
   */
  const callVoiceWorker = async (input: { audio: Blob } | { text: string }) => {
    // Cancel any prior in-flight request before starting a new one
    inflightAbortRef.current?.abort()
    const ctrl = new AbortController()
    inflightAbortRef.current = ctrl

    try {
      // Get the user's JWT — the Edge Function has verify_jwt=true
      const { data: sessionData } = await supabase.auth.getSession()
      const jwt = sessionData.session?.access_token
      if (!jwt) {
        vocalizeSilentFailsafe('Sesión expirada. Recarga la página.')
        return
      }

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` }
      let body: BodyInit

      // Send the locally-persisted chat history as a fallback. The edge
      // function prefers Redis-stored session if Upstash is configured, but
      // falls back to this when Redis isn't available — without it,
      // anaphoric references like "borra al duplicado" lose context and
      // the LLM hallucinates technical-sounding text.
      const historyJson = JSON.stringify(chatHistory)

      if ('audio' in input) {
        const form = new FormData()
        form.append('audio',    input.audio, 'audio.webm')
        form.append('timezone', timezone)
        form.append('history',  historyJson)
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({ text: input.text, timezone, history: chatHistory })
      }

      const res = await fetch(VOICE_WORKER_URL, {
        method:  'POST',
        headers,
        body,
        signal:  ctrl.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const status  = res.status
        logger.error('VoiceAssistantFab', `Edge Function error ${status}`, errData)
        const msg = status === 401 ? 'Sin acceso al asistente.'
                  : status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
                  : (errData as { error?: string }).error || 'Error al contactar a Luis.'
        vocalizeSilentFailsafe(msg)
        return
      }

      const data = await res.json() as {
        text:            string
        audioUrl:        string | null
        actionPerformed: boolean
        transcription:   string
      }

      // Refresh data caches if the agent wrote something
      if (data.actionPerformed) {
        void queryClient.invalidateQueries({ queryKey: ['appointments']     })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-stats']  })
        void queryClient.invalidateQueries({ queryKey: ['clients']          })
        void queryClient.invalidateQueries({ queryKey: ['notifications']    })
      }

      // Append both turns to the in-memory chat history for context across taps
      setChatHistory(prev => [
        ...prev,
        { role: 'user',      content: data.transcription || (('text' in input) ? input.text : '') },
        { role: 'assistant', content: data.text },
      ].slice(-15))

      // Play the response audio (or fall back to TTS endpoint with the text)
      setState('speaking')
      const fallback = data.actionPerformed ? 'Listo.' : 'No te entendí bien, ¿puedes repetir?'
      if (data.audioUrl) {
        await playAudio(data.audioUrl, data.text || fallback)
      } else if (data.text.trim()) {
        await speakTtsText(data.text)
      } else {
        vocalizeSilentFailsafe(fallback)
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user tap — do nothing, state already reset
        return
      }
      logger.error('VoiceAssistantFab', 'Network error calling voice-worker', err)
      vocalizeSilentFailsafe('Error de red. Intenta de nuevo.')
    } finally {
      if (inflightAbortRef.current === ctrl) inflightAbortRef.current = null
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  const startRecording = async () => {
    unlockAudioPlayback()

    // Mobile Android Chrome PWA: Web Speech API conflicts with parallel getUserMedia
    // (volume monitor) and returns empty transcripts — silent failure, the button
    // never enters "processing" state and goes straight back to idle.
    // On mobile we force the MediaRecorder + server-side STT (Deepgram) path which always works.
    const isMobile = typeof navigator !== 'undefined'
      && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

    // ── Web Speech API path (desktop Chrome/Edge only) ─────────────────────
    const SpeechRecognitionAPI = !isMobile
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null
    if (SpeechRecognitionAPI) {
      setState('listening')
      setVolume(0)

      const recognition = new SpeechRecognitionAPI()
      recognitionRef.current = recognition
      recognition.lang             = 'es-ES'
      recognition.continuous       = false
      recognition.interimResults   = false
      recognition.maxAlternatives  = 1

      // Open a parallel mic stream for volume monitoring.
      // Web Speech API doesn't expose the raw MediaStream, so we open an independent
      // getUserMedia() alongside it. Both can access the mic without conflict.
      let monitorStream: MediaStream | null = null
      const stopMonitor = () => {
        if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
        monitorStream?.getTracks().forEach(t => t.stop())
        monitorStream = null
        analyserRef.current = null
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {/* ignore */})
          audioContextRef.current = null
        }
      }

      navigator.mediaDevices?.getUserMedia({ audio: true }).then(stream => {
        monitorStream = stream
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        audioContextRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.6
        ctx.createMediaStreamSource(stream).connect(analyser)
        analyserRef.current = analyser
        const tdArray = new Uint8Array(analyser.fftSize)
        const monitorLoop = () => {
          if (!analyserRef.current) return
          analyserRef.current.getByteTimeDomainData(tdArray)
          const rms = Math.sqrt(tdArray.reduce((s, v) => s + (v - 128) ** 2, 0) / tdArray.length)
          setVolume(Math.min((rms / 128) * 5, 1))
          rafIdRef.current = requestAnimationFrame(monitorLoop)
        }
        rafIdRef.current = requestAnimationFrame(monitorLoop)
      }).catch(() => { /* no volume display if permission denied */ })

      // Track whether onresult ever fired so we can detect "silent" recognition
      // (onend fires without onresult/onerror) — common cause of "desktop no
      // me responde nada".
      let resultFired = false

      recognition.onresult = (event: any) => {
        resultFired = true
        recognitionRef.current = null
        stopMonitor()
        const transcript = Array.from(event.results as any[])
          .map((r: any) => r[0].transcript)
          .join('')
          .trim()
        logger.info('VoiceAssistantFab', 'Speech recognition onresult', { transcript, length: transcript.length })
        if (transcript) {
          setState('processing')
          void callVoiceWorker({ text: transcript })
        } else {
          // Empty transcript — give the user audio feedback so they know
          // the system is alive but didn't catch their voice.
          vocalizeSilentFailsafe('No te escuché bien, intenta de nuevo.')
          setState('idle')
        }
      }

      recognition.onerror = (event: any) => {
        resultFired = true
        recognitionRef.current = null
        stopMonitor()
        logger.warn('VoiceAssistantFab', 'Speech recognition onerror', { error: event.error })
        if (event.error === 'no-speech') {
          // Audio feedback so the user knows we're alive but heard nothing.
          vocalizeSilentFailsafe('No te escuché, ¿puedes repetir más fuerte?')
          return
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          vocalizeSilentFailsafe('Necesito permiso para el micrófono. Actívalo en la configuración del navegador.')
        } else {
          vocalizeSilentFailsafe('No pude escucharte. Intenta de nuevo.')
        }
        setState('idle')
      }

      recognition.onend = () => {
        recognitionRef.current = null
        stopMonitor()
        // If onend fires WITHOUT onresult or onerror, the recognition silently
        // failed (Chrome desktop bug, often when network or speech service is
        // unavailable). Surface this to the user with audio feedback instead
        // of just resetting silently.
        if (!resultFired) {
          logger.warn('VoiceAssistantFab', 'Speech recognition ended without result/error — silent failure')
          vocalizeSilentFailsafe('No pude reconocer tu voz. Intenta de nuevo en unos segundos.')
          return
        }
        setState((s: AssistantState) => s === 'listening' ? 'idle' : s)
      }

      try {
        recognition.start()
        logger.info('VoiceAssistantFab', 'Speech recognition started (desktop Web Speech API)')
      } catch (err) {
        recognitionRef.current = null
        stopMonitor()
        logger.error('VoiceAssistantFab', 'Speech recognition start threw', err)
        vocalizeSilentFailsafe('No se pudo iniciar el reconocimiento de voz.')
        setState('idle')
      }
      return
    }

    // ── MediaRecorder fallback (Firefox / non-Chromium) ────────────────────
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

        // Only block if literally NO audio was captured. The VAD speech-detection
        // gate (`hasSpokenRef`) was discarding valid audio on mobile because the
        // noise-floor calibration races with the user starting to speak immediately
        // after tapping. The server-side STT has its own empty-audio guard.
        if (audioChunksRef.current.length === 0) {
          setState('idle')
          return
        }

        await callVoiceWorker({ audio: new Blob(audioChunksRef.current, { type: mimeType }) })
      }

      mediaRecorder.start(250)

      // VAD — RMS-based voice activity detection with adaptive noise floor.
      // MAX_RECORD_MS is a hard cap: after this, send what we have (no more waiting).
      // Mobile users tap-and-talk immediately; calibration races with their voice
      // and noise_floor gets set too high, so VAD speech detection is unreliable.
      // Hard cap ensures we always send the captured audio, even if VAD failed.
      const MIN_RMS_FLOOR    = 5
      const SILENCE_DURATION = 600
      const MAX_RECORD_MS    = 6000   // Hard cap on recording duration
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

        // Hard cap — always honored, regardless of VAD state.
        // Sends whatever audio was captured to the server-side STT for handling.
        if (elapsed >= MAX_RECORD_MS) {
          stopRecording()
          return
        }

        if (!calibrated) {
          noiseFloorSamples.push(rms)
          if (elapsed >= 200) {  // 200ms ≈ 12 samples at 60fps — sufficient for noise floor
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
          }
          // Removed the MAX_WAIT_MS branch — the hard cap above handles all timeouts.
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
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
      recognitionRef.current = null
    }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (rafIdRef.current)        { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const handleClick = () => {
    // Prime audio pipeline on every click — the initial one unlocks Audio.play()
    // so the deferred result audio (arriving long after the gesture) can play.
    unlockAudioPlayback()

    if (state === 'speaking') {
      currentAudioRef.current?.pause()
      currentAudioRef.current = null
      setState('idle')
      return
    }
    if (state === 'processing') {
      // Cancel the in-flight Edge Function call and reset.
      inflightAbortRef.current?.abort()
      inflightAbortRef.current = null
      setState('idle')
      return
    }
    if (state === 'idle')      startRecording()
    if (state === 'listening') stopRecording()
  }

  // Cleanup on unmount: cancel any in-flight request.
  useEffect(() => {
    return () => {
      inflightAbortRef.current?.abort()
      inflightAbortRef.current = null
    }
  }, [])

  // Safety timeout: 45s max in processing/speaking. Real responses come back
  // in 3-7s; if we're still here at 45s, something hung (audio playback locked
  // by mobile autoplay policy, network blip, etc.). Force back to idle so the
  // user can tap again instead of having to reload the PWA.
  useEffect(() => {
    if (state !== 'speaking' && state !== 'processing') return
    const timer = setTimeout(() => {
      inflightAbortRef.current?.abort()
      inflightAbortRef.current = null
      currentAudioRef.current?.pause()
      setState('idle')
    }, 45_000)
    return () => clearTimeout(timer)
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
}
