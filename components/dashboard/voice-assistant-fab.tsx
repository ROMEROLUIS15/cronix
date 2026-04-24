'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import type { BusinessSettingsJson } from '@/types'
import { VoiceVisualizer } from './voice-visualizer'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

// Returns the first MIME type the browser's MediaRecorder actually supports.
// Prevents the NotSupportedError that kills recording silently on some Windows browsers.
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
  const [transcript, setTranscript] = useState<string>('')
  const [chatHistory, setChatHistory] = useState<{role: string, content: string}[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = sessionStorage.getItem('cronix-assistant-history')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [isLoaded, setIsLoaded] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('Procesando...')
  const [showLuisFab, setShowLuisFab] = useState(true)

  // ── Persist chat history across page refreshes ──────────────────────────
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

    // Cloud Visibility Sync
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
  const [volume, setVolume] = useState(0)

  // ── Helper: show status message. Pass ms=0 to keep it visible until next action. ──
  // Persistent statuses are used for critical errors (timeout, 429, no-response) so the
  // user can actually read them instead of missing them in a 3-second flash.
  const showStatus = (msg: string, ms = 3000) => {
    setTranscript(msg)
    if (ms > 0) setTimeout(() => setTranscript(''), ms)
  }

  // Hard failsafe: if the server returns neither audio nor text, vocalize a fallback
  // via the Web Speech API so the FAB never sits silently after a request.
  const vocalizeSilentFailsafe = (msg: string) => {
    showStatus(msg, 0)
    setState('speaking')
    speakWithNativeFallback(msg) // sets state back to 'idle' via onend/onerror
  }

  // Fetch with a hard client-side timeout. Groq + TTS can take ~15-25s on slow paths;
  // 45s is a generous ceiling that still catches a hung request instead of leaving
  // the FAB stuck in 'processing' until the 30s UI safety timeout fires silently.
  const FETCH_TIMEOUT_MS = 45000
  const fetchWithTimeout = (url: string, opts: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer))
  }

  // ── Helper: Google masculine TTS fallback (activates when Deepgram fails) ─
  // Priority chain:
  //   1. "Google español"         — Chrome's native Google TTS, masculine Spanish
  //   2. Any Google Spanish voice — other Google es-* voices in Chrome
  //   3. Named male Spanish voice — Microsoft Raúl, Pablo, etc.
  //   4. Any non-female Spanish   — last Spanish resort, pitch crushed to 0.1
  //   5. Google English male      — better than silence
  //   6. Any voice at pitch 0.1   — absolute floor, sounds baritone regardless
  const speakWithNativeFallback = (text: string) => {
    if (!('speechSynthesis' in window)) { setState('idle'); return }

    const FEMALE_MARKERS = [
      'helena', 'sabina', 'paulina', 'conchita', 'female', 'mujer',
      'feminin', 'mónica', 'monica', 'lucia', 'lucía', 'microsoft laura',
      'microsoft sabina',
    ]
    const MALE_MARKERS = [
      'raul', 'raúl', 'pablo', 'diego', 'carlos', 'jorge', 'miguel',
      'david', 'jose', 'juan', 'antonio', 'daniel', 'male',
    ]

    const utterance  = new SpeechSynthesisUtterance(text)
    utterance.lang   = 'es-MX'
    utterance.rate   = 0.9
    // pitch 0.1 = practical floor of Web Speech API — forces baritone on any voice
    utterance.pitch  = 0.1

    const selectVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      const n = (v: SpeechSynthesisVoice) => v.name.toLowerCase()

      // T1: "Google español" — Chrome's built-in Google TTS masculine Spanish voice
      let chosen: SpeechSynthesisVoice | undefined =
        voices.find(v => n(v) === 'google español')

      // T2: Any Google voice in Spanish (e.g. "Google español de Estados Unidos")
      if (!chosen) chosen = voices.find(v =>
        n(v).includes('google') && v.lang.startsWith('es')
      )

      // T3: Named male Spanish voice (Microsoft Raúl / Pablo on Windows)
      if (!chosen) chosen = voices.find(v =>
        v.lang.startsWith('es') &&
        MALE_MARKERS.some(m => n(v).includes(m)) &&
        !FEMALE_MARKERS.some(f => n(v).includes(f))
      )

      // T4: Any Spanish voice without explicit female marker (pitch crushes to masculine)
      if (!chosen) chosen = voices.find(v =>
        v.lang.startsWith('es') && !FEMALE_MARKERS.some(f => n(v).includes(f))
      )

      // T5: Google English male (intelligible, still masculine)
      if (!chosen) chosen = voices.find(v =>
        n(v).includes('google') &&
        v.lang.startsWith('en') &&
        !FEMALE_MARKERS.some(f => n(v).includes(f))
      )

      // T6: Absolute fallback — any available voice; pitch 0.1 forces baritone
      if (!chosen) chosen = voices[0]

      if (chosen) utterance.voice = chosen
      utterance.onend  = () => { setState('idle'); setTimeout(() => setTranscript(''), 2000) }
      utterance.onerror = () => setState('idle')
      window.speechSynthesis.speak(utterance)
    }

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = selectVoice
    } else {
      selectVoice()
    }
  }

  // ── Helper: play audio from URL (streaming or data URL) ──────────────────
  // Isolated from network errors — audio.play() rejection must never show
  // "Error de conexión". It falls back to Google masculine synthesis instead.
  const playAudio = async (src: string, fallbackText: string) => {
    return new Promise<void>((resolve) => {
      const audio = new Audio(src)
      currentAudioRef.current = audio

      audio.onended = () => {
        setState('idle')
        setTimeout(() => setTranscript(''), 3000)
        resolve()
      }

      audio.onerror = () => {
        logger.error('VoiceAssistantFab', 'Audio playback failed — activating Google TTS fallback')
        speakWithNativeFallback(fallbackText)
        resolve()
      }

      // play() can reject due to autoplay policy or format error.
      // Catch it here — never let it bubble to the network error handler.
      audio.play().catch(() => {
        speakWithNativeFallback(fallbackText)
        resolve()
      })
    })
  }

  // ── Core: send audio blob to API ─────────────────────────────────────────
  const sendAudioToAssistant = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio',    audioBlob, 'audio.webm')
      formData.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
      formData.append('history',  JSON.stringify(chatHistory))

      const res = await fetchWithTimeout('/api/assistant/voice', { method: 'POST', body: formData })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        logger.error('VoiceAssistantFab', `API error ${res.status}`, errData)
        // Persistent status (ms=0) on critical errors — a 3-second toast is easy to miss
        // after a long pause, and users re-try thinking nothing happened.
        const errMsg = res.status === 403 ? 'Sin acceso al asistente'
                     : res.status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
                     : 'Error al contactar a Luis'
        showStatus(errMsg, 0)
        setState('idle')
        return
      }

      const data = await res.json()

      if (data.actionPerformed) {
        void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', businessId] })
      }

      if (data.history) {
        setChatHistory(data.history.slice(-15))
      } else {
        setChatHistory(prev => [
          ...prev,
          { role: 'user',      content: data.debug?.transcription || 'Audio enviado' },
          { role: 'assistant', content: data.text || '' },
        ].slice(-15))
      }

      setState('speaking')

      if (data.audioUrl) {
        // Deepgram base64 audio (from server TTS)
        await playAudio(data.audioUrl, data.text)
      } else if (data.text) {
        // Stream TTS: client fetches audio directly from Deepgram via our proxy.
        // Browser plays while bytes are still downloading — zero buffering wait.
        const streamUrl = `/api/assistant/tts?t=${encodeURIComponent(data.text.slice(0, 500))}`
        await playAudio(streamUrl, data.text)
      } else {
        // Failsafe: server returned neither audio nor text. Vocalize + persistent status
        // so the user never faces a silent FAB after a request. Especially important
        // if a booking completed server-side but the confirmation was somehow lost.
        logger.warn('VoiceAssistantFab', 'Server returned empty response — using vocal failsafe', { actionPerformed: data.actionPerformed })
        vocalizeSilentFailsafe(
          data.actionPerformed
            ? 'La acción se completó. Verifica el tablero.'
            : 'No recibí respuesta. Por favor intenta de nuevo.'
        )
      }

    } catch (err: unknown) {
      // AbortError from the 45s fetch timeout — distinguishes hangs from generic network errors
      if (err instanceof DOMException && err.name === 'AbortError') {
        logger.warn('VoiceAssistantFab', 'Fetch aborted — server timeout exceeded 45s')
        vocalizeSilentFailsafe('Tiempo de espera agotado. Intenta de nuevo.')
        return
      }
      logger.error('VoiceAssistantFab', 'Network error contacting assistant', err)
      showStatus('Error de red — reintenta', 0)
      setState('idle')
    }
  }

  // ── Core: send text to API (streaming mode) ──────────────────────────────
  const sendTextToAssistant = async (text: string) => {
    try {
      const res = await fetchWithTimeout('/api/assistant/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text, history: chatHistory, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })

      if (!res.ok) {
        const errMsg = res.status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
                     : 'Error al conectar con Luis'
        showStatus(errMsg, 0)
        setState('idle')
        return
      }

      const data = await res.json()

      if (data.actionPerformed) {
        void queryClient.invalidateQueries({ queryKey: ['appointments', businessId] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', businessId] })
      }

      if (data.history) {
        setChatHistory(data.history.slice(-15))
      } else {
        setChatHistory(prev => [
          ...prev,
          { role: 'user',      content: text },
          { role: 'assistant', content: data.text || '' },
        ].slice(-15))
      }

      setState('speaking')

      if (data.audioUrl) {
        await playAudio(data.audioUrl, data.text)
      } else if (data.text) {
        const streamUrl = `/api/assistant/tts?t=${encodeURIComponent(data.text.slice(0, 500))}`
        await playAudio(streamUrl, data.text)
      } else {
        // Mirrors the audio-path failsafe — never leave the FAB silent after a request.
        logger.warn('VoiceAssistantFab', 'Server returned empty response (text path) — using vocal failsafe', { actionPerformed: data.actionPerformed })
        vocalizeSilentFailsafe(
          data.actionPerformed
            ? 'La acción se completó. Verifica el tablero.'
            : 'No recibí respuesta. Por favor intenta de nuevo.'
        )
      }

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        logger.warn('VoiceAssistantFab', 'Fetch aborted — server timeout exceeded 45s (text path)')
        vocalizeSilentFailsafe('Tiempo de espera agotado. Intenta de nuevo.')
        return
      }
      logger.error('VoiceAssistantFab', 'Error sending text to assistant', err)
      showStatus('Error de red — reintenta', 0)
      setState('idle')
    }
  }

  // ── Core: start recording ────────────────────────────────────────────────
  const startRecording = async () => {
    // Guard: check MediaDevices API availability
    if (!navigator.mediaDevices?.getUserMedia) {
      showStatus('Micrófono no disponible. Usa Chrome o Edge en escritorio.')
      return
    }

    const mimeType = getSupportedMimeType()
    if (!mimeType) {
      showStatus('Tu navegador no soporta grabación de audio')
      return
    }

    setState('listening')
    setTranscript('')
    setVolume(0)
    audioChunksRef.current = []
    hasSpokenRef.current   = false

    let stream: MediaStream
    try {
      // getUserMedia is the definitive source of truth for mic access.
      // We do NOT pre-check navigator.permissions — its cached state causes
      // false positives when the user enables the permission without reloading.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as DOMException).name : ''
      const msg  = err instanceof Error ? err.message : String(err)
      logger.error('VoiceAssistantFab', 'Microphone access failed', { name, msg })
      setState('idle')

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        // Two sub-cases:
        // 1. User dismissed the browser prompt → Chrome shows permission as "ask"
        // 2. Windows OS blocks Chrome system-wide → Chrome site toggle looks OK but OS denies
        showStatus('Permite el micrófono en el 🔒 de la barra de dirección y recarga la página', 6000)
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showStatus('No se detectó ningún micrófono conectado al equipo')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showStatus('El micrófono está siendo usado por otra aplicación. Ciérrala e intenta de nuevo.')
      } else {
        showStatus('No se pudo acceder al micrófono')
      }
      return
    }

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const audioContext = audioContextRef.current
      if (audioContext.state === 'suspended') await audioContext.resume()

      const analyser = audioContext.createAnalyser()
      analyser.fftSize         = 512   // larger window → more accurate RMS
      analyser.smoothingTimeConstant = 0.2  // fast response, no lag
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
          showStatus('No te escuché. Vuelve a intentarlo.')
          return
        }

        setProcessingLabel('Escuchando tu voz...')
        setTranscript('')
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        const feedbackTimer = setTimeout(() => setProcessingLabel('Luis está pensando...'), 2000)
        try {
          await sendAudioToAssistant(audioBlob)
        } finally {
          clearTimeout(feedbackTimer)
        }
      }

      mediaRecorder.start(250)

      // VAD — RMS-based voice activity detection with adaptive noise floor
      //
      // Why RMS over frequency average:
      //   getByteFrequencyData average treats all frequency bins equally — noise
      //   at low frequencies (fans, AC) inflates the average and causes false triggers.
      //   RMS from time-domain data measures actual signal energy with no frequency bias.
      //
      // Phases:
      //   1. Calibration (400ms): measure ambient noise floor silently.
      //   2. Wait for speech: RMS must exceed 2.5× noise floor to count as voice.
      //   3. Silence detection: RMS drops below 70% of threshold for 600ms → stop.
      //      The 70% hysteresis prevents false stops during brief breath pauses.
      const MIN_RMS_FLOOR    = 5    // absolute floor — avoids muting in very quiet rooms
      const SILENCE_DURATION = 600  // ms of sustained silence before auto-stop
      const MAX_WAIT_MS      = 8000 // max wait if no speech ever detected
      const startTime        = Date.now()
      const tdArray          = new Uint8Array(analyser.fftSize) // time-domain buffer

      let calibrated              = false
      let noiseFloor              = MIN_RMS_FLOOR
      const noiseFloorSamples: number[] = []

      const monitor = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return

        // Time-domain: 0–255 centered at 128 → subtract 128 for signed amplitude
        analyser.getByteTimeDomainData(tdArray)
        const rms = Math.sqrt(tdArray.reduce((sum, v) => sum + (v - 128) ** 2, 0) / tdArray.length)
        // Scale for visualizer: RMS 0–128, amplify so typical speech fills the bar
        setVolume(Math.min((rms / 128) * 5, 1))

        const elapsed = Date.now() - startTime

        // Phase 1 — calibrate noise floor during first 400ms of silence
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

        // Phase 2 — wait for first speech sample
        if (!hasSpokenRef.current) {
          if (rms > noiseFloor) {
            hasSpokenRef.current = true
          } else if (elapsed > MAX_WAIT_MS) {
            stopRecording()
            return
          }
        } else {
          // Phase 3 — silence detection with hysteresis
          // Only count as silence if RMS drops below 70% of threshold,
          // so a brief breath pause (80–90% amplitude drop) doesn't cut early.
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
      showStatus('Error al iniciar la grabación')
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
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel()
      setState('idle')
      return
    }
    if (state === 'idle')      startRecording()
    if (state === 'listening') stopRecording()
  }

  // Safety timeout: prevents getting stuck in processing/speaking.
  // 30 min matches the server-side session TTL — if the FAB hasn't finished
  // by then, the request is definitively lost and the UI must reset.
  useEffect(() => {
    if (state !== 'speaking' && state !== 'processing') return
    const timer = setTimeout(() => setState('idle'), 30 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [state])

  if (typeof window === 'undefined' || !isLoaded || !showLuisFab) return null

  // ── Shared icon/label helpers ─────────────────────────────────────────────
  const icon = () => {
    if (state === 'idle')       return <Mic className="w-4 h-4 flex-shrink-0" />
    if (state === 'listening')  return <VoiceVisualizer isActive volume={volume} isSpeaking={false} />
    if (state === 'processing') return <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
    return <VoiceVisualizer isActive volume={0.5} isSpeaking />
  }

  const label = () => {
    if (state === 'idle')       return '✦ Luis IA'
    if (state === 'listening')  return 'Escuchando...'
    if (state === 'processing') return processingLabel
    return 'Luis habla...'
  }

  return (
    <>
      {/* ── MOBILE: Draggable vertical circle ──────────────────────────── */}
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
          // stopPropagation prevents Framer Motion drag layer from eating the click
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title="Luis IA — Arrastra para mover"
          className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-colors duration-300"
          style={
            state === 'listening'
              ? { background: '#09090b', border: '2px solid rgba(168,85,247,0.8)', boxShadow: '0 0 28px rgba(168,85,247,0.5)' }
              : state === 'processing'
              ? { background: '#2563EB', boxShadow: '0 0 25px rgba(37,99,235,0.6)' }
              : state === 'speaking'
              ? { background: '#09090b', border: '2px solid rgba(56,132,255,0.8)', boxShadow: '0 0 26px rgba(56,132,255,0.5)' }
              : { background: '#09090b', border: '2px solid rgba(56,132,255,0.7)', boxShadow: '0 0 18px rgba(56,132,255,0.4)' }
          }
        >
          {state === 'idle'       && <Mic className="w-6 h-6" style={{ color: '#3884FF' }} />}
          {state === 'listening'  && <VoiceVisualizer isActive volume={volume} isSpeaking={false} />}
          {state === 'processing' && <Loader2 className="w-6 h-6 text-white animate-spin" />}
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
          // stopPropagation prevents Framer Motion drag layer from eating the click
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title={t('fabTitle')}
          className={`relative flex items-center gap-2.5 h-10 px-4 rounded-full transition-all duration-300 font-semibold text-sm select-none ${
            state === 'idle' ? 'hover:scale-105' : state === 'listening' ? 'scale-105' : ''
          }`}
          style={
            state === 'listening'
              ? { background: 'rgba(5,5,10,0.9)', color: '#fff', border: '1.5px solid rgba(168,85,247,0.8)', boxShadow: '0 0 22px rgba(168,85,247,0.45)', backdropFilter: 'blur(12px)' }
              : state === 'processing'
              ? { background: 'rgba(37,99,235,0.9)', color: '#fff', border: '1.5px solid rgba(37,99,235,0.8)' }
              : state === 'speaking'
              ? { background: 'rgba(5,5,10,0.9)', color: '#fff', border: '1.5px solid rgba(56,132,255,0.8)', boxShadow: '0 0 22px rgba(56,132,255,0.4)', backdropFilter: 'blur(12px)' }
              : { background: 'rgba(5,5,10,0.85)', color: '#3884FF', border: '1.5px solid rgba(56,132,255,0.55)', boxShadow: '0 0 18px rgba(56,132,255,0.25)', backdropFilter: 'blur(12px)' }
          }
        >
          {icon()}
          <span className="leading-none">{label()}</span>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${state === 'idle' ? 'bg-[#3884FF]' : 'bg-white animate-pulse'}`} />
        </button>

        {/* Status / transcript bubble */}
        {transcript && (
          <div
            className="text-xs px-3 py-1.5 rounded-full max-w-[220px] truncate"
            style={{ background: 'rgba(5,5,10,0.85)', color: '#909098', border: '1px solid #272729', backdropFilter: 'blur(8px)' }}
          >
            {transcript}
          </div>
        )}
      </motion.div>
    </>
  )
}
