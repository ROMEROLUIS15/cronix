'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

export function VoiceAssistantFab() {
  const [state, setState] = useState<AssistantState>('idle')
  const [transcript, setTranscript] = useState<string>('')
  const [isLoaded, setIsLoaded] = useState(false)
  
  // ── Drag & Persistence ──────────────────────────────────────────────────
  const y = useMotionValue(0)
  // Spring for smooth snapping/movement
  const springY = useSpring(y, { stiffness: 300, damping: 30 })

  useEffect(() => {
    const savedY = localStorage.getItem('cronix-assistant-y')
    if (savedY) {
      y.set(parseFloat(savedY))
    }
    setIsLoaded(true)

    // ── PROACTIVE GREETING (Once per session) ──
    const hasGreeted = sessionStorage.getItem('cronix-assistant-greeted')
    const abortController = new AbortController()
    let timer: NodeJS.Timeout | null = null

    if (!hasGreeted) {
      timer = setTimeout(async () => {
        try {
          const res = await fetch('/api/assistant/proactive', { signal: abortController.signal })
          const data = await res.json()
          if (data.text && !abortController.signal.aborted) {
            setTranscript(data.text)
            sessionStorage.setItem('cronix-assistant-greeted', 'true')
            
            if (data.audioUrl) {
              const audio = new Audio(data.audioUrl)
              setState('speaking')
              audio.onended = () => setState('idle')
              await audio.play()
            }
          }
        } catch (e) {
          if (e instanceof Error && e.name !== 'AbortError') {
            console.error('Proactive Assistant Error:', e)
          }
        }
      }, 2000)
    }

    return () => {
      if (timer) clearTimeout(timer)
      abortController.abort()
    }
  }, [y])

  const handleDragEnd = () => {
    localStorage.setItem('cronix-assistant-y', y.get().toString())
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const hasSpokenRef = useRef<boolean>(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null) // To stop current playback

  // ── Helper: Speak with Native Browser Voice (Fallback) ──
  const speakWithNativeFallback = (text: string) => {
    if (!('speechSynthesis' in window)) {
      setState('idle')
      return
    }

    console.warn('AI-VOICE | Using Browser Fallback (Deepgram might be failing)')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-MX'
    utterance.rate = 0.95
    utterance.pitch = 0.7 // FORCED BARITONE

    const selectMaleVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      // Priority: Spanish Male -> Any Spanish
      let voice = voices.find(v => 
        v.lang.startsWith('es') && 
        (v.name.toLowerCase().includes('raul') || 
         v.name.toLowerCase().includes('pablo') ||
         v.name.toLowerCase().includes('david') || 
         v.name.toLowerCase().includes('jose') ||
         v.name.toLowerCase().includes('male'))
      )
      if (!voice) voice = voices.find(v => v.lang.startsWith('es'))
      
      if (voice) {
        console.log('Luis IA | Native Voice:', voice.name)
        utterance.voice = voice
      }
      
      utterance.onend = () => { setState('idle'); setTimeout(() => setTranscript(''), 2000) }
      window.speechSynthesis.speak(utterance)
    }

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = selectMaleVoice
    } else {
      selectMaleVoice()
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Initialize AudioContext only once
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const audioContext = audioContextRef.current
      if (audioContext.state === 'suspended') await audioContext.resume()

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      analyserRef.current = analyser

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      hasSpokenRef.current = false // Reset speech detection

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        
        // Skip if nothing was heard or clip is too small
        if (!hasSpokenRef.current || audioBlob.size < 1500) {
          console.warn('Audio too short or no speech detected')
          setState('idle')
          if (!hasSpokenRef.current) {
            setTranscript('Lo siento, no escuché nada. Inténtalo de nuevo.')
            setTimeout(() => setTranscript(''), 3000)
          }
          return
        }

        await sendAudioToAssistant(audioBlob)
      }

      mediaRecorder.start()
      setState('listening')
      setTranscript('')

      // Monitoring Loop (VAD) - Two-Phase Logic
      const SILENCE_THRESHOLD = 6 // Senior Fix: Higher sensitivity post-response
      const SILENCE_DURATION = 2000 // 2s of silence to finalize
      const MAX_LISTEN_WAIT = 5000 // Max 5s waiting for initial speech
      const startTime = Date.now()
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      
      const monitor = () => {
        if (!analyserRef.current || !mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          return
        }
        
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((prev, curr) => prev + curr, 0) / dataArray.length
        
        // Phase 1: Wait for speech
        if (!hasSpokenRef.current) {
          if (average > SILENCE_THRESHOLD) {
            hasSpokenRef.current = true
            console.log('Voice activity detected!')
          } else if (Date.now() - startTime > MAX_LISTEN_WAIT) {
            console.warn('VAD: Initial timeout (no speech detected)')
            stopRecording()
            return
          }
        } 
        
        // Phase 2: Wait for silence (only after speech detected)
        if (hasSpokenRef.current) {
          if (average < SILENCE_THRESHOLD) {
            if (!silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => stopRecording(), SILENCE_DURATION)
            }
          } else {
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current)
              silenceTimerRef.current = null
            }
          }
        }

        rafIdRef.current = requestAnimationFrame(monitor)
      }
      monitor()

    } catch (err) {
      console.error('Error starting recording:', err)
      setState('idle')
    }
  }

  const stopRecording = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setState('processing')
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
    }
  }

  const sendAudioToAssistant = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)

      const res = await fetch('/api/assistant/voice', { method: 'POST', body: formData })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Error en servidor')
      }

      const data = await res.json()
      console.log('AI-REPLY:', { text: data.text, hasAudio: !!data.audioUrl, actionPerformed: data.actionPerformed })
      
      // 🌟 MASTER TOUCH: Notify dashboard to refresh data if an action was taken
      if (data.actionPerformed) {
        window.dispatchEvent(new CustomEvent('cronix:refresh-data'))
      }

      // Update UI transcript (discreet)
      setTranscript(data.text.length > 60 ? data.text.slice(0, 57) + '...' : data.text)
      
      if (data.audioUrl) {
        setState('speaking')
        const audio = new Audio(data.audioUrl)
        currentAudioRef.current = audio
        audio.onended = () => {
          setState('idle')
          currentAudioRef.current = null
          setTimeout(() => setTranscript(''), 4000)
        }
        audio.onerror = () => speakWithNativeFallback(data.text)
        await audio.play().catch(() => speakWithNativeFallback(data.text))
      } else {
        speakWithNativeFallback(data.text)
      }

    } catch (error: any) {
      console.error(error)
      setState('idle')
      setTranscript(`❌ Error: ${error.message || 'Error desconocido'}`)
      setTimeout(() => setTranscript(''), 3000)
    }
  }

  const toggleRecording = () => {
    // 🛑 SENIOR FIX: Option 2 — If speaking, JUST STOP (Suspend). Don't auto-record.
    if (state === 'speaking') {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
        currentAudioRef.current = null
      }
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
      }
      setState('idle')
      return
    }

    if (state === 'idle') startRecording()
    else if (state === 'listening') stopRecording()
  }

  // Safety Timeout: Prevent being stuck in 'speaking' or 'processing'
  useEffect(() => {
    let timer: NodeJS.Timeout
    if (state === 'speaking' || state === 'processing') {
      timer = setTimeout(() => {
        console.warn(`Safety timeout: Resetting assistant to idle from state: ${state}`)
        setState('idle')
      }, 15000) // 15s max for any voice action
    }
    return () => clearTimeout(timer)
  }, [state])

  const isClient = typeof window !== 'undefined'
  if (!isClient || !isLoaded) return null

  return (
    <>
      {/* ── MOBILE: Draggable Vertical Circle ── */}
      <motion.div 
        drag="y"
        dragConstraints={{ top: -300, bottom: 20 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        style={{ y: springY }}
        className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 sm:hidden touch-none"
      >
        {transcript && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-950/90 border border-zinc-800 text-white text-xs px-4 py-3 rounded-2xl shadow-2xl max-w-[200px] backdrop-blur-md"
          >
            <p className="leading-snug">{transcript}</p>
          </motion.div>
        )}
        
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileDrag={{ scale: 1.1, cursor: 'grabbing' }}
          type="button"
          onClick={toggleRecording}
          title="Asistente IA (Arrastra para mover)"
          className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-colors duration-300"
          style={
            state === 'listening'
              ? { background: '#EF4444', boxShadow: '0 0 25px rgba(239,68,68,0.6)' }
              : state === 'processing' || state === 'speaking'
              ? { background: '#2563EB', boxShadow: '0 0 25px rgba(37,99,235,0.6)' }
              : {
                  background: '#09090b',
                  border: '2px solid rgba(56,132,255,0.7)',
                  boxShadow: '0 0 18px rgba(56,132,255,0.4)',
                }
          }
        >
          {state === 'listening' && (
            <span className="absolute inset-0 rounded-full bg-red-400 opacity-50 animate-ping" />
          )}
          {state === 'idle' && <Mic className="w-6 h-6" style={{ color: '#3884FF' }} />}
          {state === 'listening' && <Square className="w-5 h-5 text-white fill-current" />}
          {(state === 'processing' || state === 'speaking') && <Loader2 className="w-6 h-6 text-white animate-spin" />}
          
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-zinc-700 rounded-full opacity-30" />
        </motion.button>
      </motion.div>

      {/* ── DESKTOP: Premium Pill design ── */}
      <div className="hidden sm:flex fixed top-[72px] right-6 z-50 flex-col items-end gap-3">
        {transcript && (
          <div
            className="text-white text-sm px-4 py-3 rounded-2xl shadow-2xl max-w-sm animate-in slide-in-from-top-2 fade-in duration-300"
            style={{
              background: 'rgba(10,10,15,0.92)',
              border: '1px solid rgba(56,132,255,0.25)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(56,132,255,0.1)',
            }}
          >
            <p className="leading-snug text-zinc-100">{transcript}</p>
          </div>
        )}

        <button
          type="button"
          onClick={toggleRecording}
          title="Asistente Ejecutivo IA — Mantén presionado o clic para hablar"
          className={`relative flex items-center gap-2.5 h-10 px-4 rounded-full transition-all duration-300 font-semibold text-sm select-none ${
            state === 'listening'
              ? 'shadow-[0_0_24px_rgba(239,68,68,0.7)] scale-105'
              : state === 'processing' || state === 'speaking'
              ? 'shadow-[0_0_24px_rgba(37,99,235,0.7)]'
              : 'hover:scale-105'
          }`}
          style={
            state === 'listening'
              ? { background: '#EF4444', color: '#fff', border: '1.5px solid rgba(239,68,68,0.8)' }
              : state === 'processing' || state === 'speaking'
              ? { background: 'rgba(37,99,235,0.9)', color: '#fff', border: '1.5px solid rgba(37,99,235,0.8)' }
              : {
                  background: 'rgba(5,5,10,0.85)',
                  color: '#3884FF',
                  border: '1.5px solid rgba(56,132,255,0.55)',
                  boxShadow: '0 0 18px rgba(56,132,255,0.25), inset 0 0 12px rgba(56,132,255,0.04)',
                  backdropFilter: 'blur(12px)',
                }
          }
        >
          {state === 'listening' && (
            <span className="absolute inset-0 rounded-full bg-red-400 opacity-30 animate-ping" />
          )}
          {state === 'idle' && <Mic className="w-4 h-4 flex-shrink-0" />}
          {state === 'listening' && <Square className="w-3.5 h-3.5 fill-current flex-shrink-0" />}
          {(state === 'processing' || state === 'speaking') && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}

          <span>
            {state === 'idle' && '✦ Luis IA'}
            {state === 'listening' && 'Escuchando...'}
            {state === 'processing' && 'Procesando...'}
            {state === 'speaking' && 'Luis habla...'}
          </span>

          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              state === 'idle' ? 'bg-[#3884FF]' : state === 'listening' ? 'bg-white animate-pulse' : 'bg-white'
            }`}
          />
        </button>
      </div>
    </>
  )
}
