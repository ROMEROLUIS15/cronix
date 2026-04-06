'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { captureException } from '@sentry/nextjs'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import type { BusinessSettingsJson } from '@/types'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

export function VoiceAssistantFab() {
  const { supabase, businessId } = useBusinessContext()
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
  const y = useMotionValue(0)
  // Spring for smooth snapping/movement
  const springY = useSpring(y, { stiffness: 300, damping: 30 })

  useEffect(() => {
    const savedY = localStorage.getItem('cronix-assistant-y')
    if (savedY) {
      y.set(parseFloat(savedY))
    }
    
    // Cloud Visibility Sync
    if (businessId) {
      const syncVisibility = async () => {
        try {
          const { data } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
          const ui = (data?.settings as unknown as BusinessSettingsJson)?.uiSettings
          if (ui?.showLuisFab === false) setShowLuisFab(false)
        } catch (error) {
          captureException(error, { context: 'fab_visibility_sync' })
        } finally {
          setIsLoaded(true)
        }
      }
      syncVisibility()
    } else {
      setIsLoaded(true)
    }

    // Real-time Dashboard Toggle Sync
    const handleToggle = (e: CustomEvent) => setShowLuisFab(e.detail)
    window.addEventListener('cronix:toggle-fab', handleToggle as EventListener)

    return () => {
      window.removeEventListener('cronix:toggle-fab', handleToggle as EventListener)
    }
  }, [y, businessId, supabase])

  const handleDragEnd = () => {
    localStorage.setItem('cronix-assistant-y', y.get().toString())
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const hasSpokenRef = useRef<boolean>(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const finalTranscriptRef = useRef<string>('')
  const audioChunksRef = useRef<Blob[]>([])

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

  const [volume, setVolume] = useState(0)
  
  // ── Component: Voice Visualizer (Siri Style) ───────────────────────────
  const VoiceVisualizer = ({ isActive, volume, isSpeaking }: { isActive: boolean, volume: number, isSpeaking: boolean }) => {
    const bars = [0, 1, 2, 3, 4]
    return (
      <div className="flex items-center gap-0.5 h-4 px-1">
        {bars.map((i) => (
          <motion.div
            key={i}
            animate={{
              height: isActive 
                ? isSpeaking 
                  ? [8, 16, 8] // Breathing rhythm
                  : Math.max(4, volume * (1 + Math.sin(i * 45) * 0.5) * 20) // Dynamic reactive
                : 4
            }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 20,
              repeat: isSpeaking ? Infinity : 0,
              duration: isSpeaking ? 0.6 + i * 0.1 : 0
            }}
            className="w-1 rounded-full"
            style={{
              background: 'linear-gradient(to top, #3884FF, #A855F7, #EC4899)',
              boxShadow: '0 0 8px rgba(56,132,255,0.4)'
            }}
          />
        ))}
      </div>
    )
  }

  const startRecording = async () => {
    try {
      setState('listening')
      setTranscript('')
      setVolume(0)
      audioChunksRef.current = []
      hasSpokenRef.current = false

      // 1. Audio Stream & MediaRecorder (Bypassing Deepgram Token issue entirely)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
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

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = async () => {
        console.log('Luis IA | Recording stopped. Bypassing Deepgram WS and uploading blob directly...')
        setState('processing')
        
        if (!hasSpokenRef.current || audioChunksRef.current.length === 0) {
          console.warn('Luis IA | Nothing heard')
          setState('idle')
          setTranscript('No te escuché bien...')
          setTimeout(() => setTranscript(''), 2000)
          return
        }

        setProcessingLabel('Escuchando tu voz...')
        setTranscript('')

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        // Progressive feedback while processing
        const feedbackTimer = setTimeout(() => setProcessingLabel('Luis está pensando...'), 2000)

        try {
          await sendAudioToAssistant(audioBlob)
        } finally {
          clearTimeout(feedbackTimer)
        }
      }

      mediaRecorder.start(250) // Send chunks every 250ms

      // 2. VAD Monitoring (Local fallback for safety)
      const SILENCE_THRESHOLD = 10
      const SILENCE_DURATION = 1800 // Balanced: enough for natural pauses but responsive
      const MAX_LISTEN_WAIT = 10000
      const startTime = Date.now()
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const monitor = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return
        
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length
        
        // 🌟 Update visualizer height
        setVolume(average / 128)

        if (!hasSpokenRef.current) {
          if (average > SILENCE_THRESHOLD) {
            hasSpokenRef.current = true
            console.log('Luis IA | Voice detected')
          } else if (Date.now() - startTime > MAX_LISTEN_WAIT) {
            stopRecording()
            return
          }
        } 

        if (hasSpokenRef.current) {
          if (average < SILENCE_THRESHOLD) {
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

    } catch (err) {
      console.error('Luis IA | Streaming Error:', err)
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
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    }
  }

  const sendAudioToAssistant = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')
      formData.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
      formData.append('history', JSON.stringify(chatHistory)) // Pass memory

      const res = await fetch('/api/assistant/voice', { 
        method: 'POST', 
        body: formData
      })

      if (!res.ok) throw new Error('Servidor no disponible')

      const data = await res.json()
      
      if (data.actionPerformed) {
        window.dispatchEvent(new CustomEvent('cronix:refresh-data'))
      }

      // We seamlessly update local memory history
      if (data.history) {
        // 🔥 SENIOR FIX: The backend now returns the full trace including Tool Calls
        setChatHistory(data.history.slice(-15))
      } else {
        // Fallback
        setChatHistory(prev => {
          const userTranscription = data.debug?.transcription || 'Audio enviado'
          const updated = [...prev, { role: 'user', content: userTranscription }, { role: 'assistant', content: data.text || '' }]
          return updated.slice(-15)
        })
      }

      // Show Luis's response text while speaking
      if (data.text) setTranscript(data.text)

      if (data.audioUrl) {
        setState('speaking')
        const audio = new Audio(data.audioUrl)
        currentAudioRef.current = audio
        audio.onended = () => {
          setState('idle')
          setTimeout(() => setTranscript(''), 4000)
        }
        await audio.play()
      } else if (data.useNativeFallback) {
        setState('speaking')
        speakWithNativeFallback(data.text)
      } else {
        setState('idle')
        setTimeout(() => setTranscript(''), 4000)
      }

    } catch (err) {
      captureException(err, { context: 'send_audio_to_assistant' })
      setState('idle')
      setTranscript('Error de conexión')
      setTimeout(() => setTranscript(''), 3000)
    }
  }

  const sendTextToAssistant = async (text: string) => {
    try {
      // 🌟 Optimized: Sending TEXT instead of AUDIO for V5 speed
      const res = await fetch('/api/assistant/voice', { 
        method: 'POST', 
        body: JSON.stringify({ 
          text, 
          history: chatHistory,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone 
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (!res.ok) throw new Error('Servidor no disponible')

      const data = await res.json()
      
      if (data.actionPerformed) {
        window.dispatchEvent(new CustomEvent('cronix:refresh-data'))
      }

      // We seamlessly update local memory history to remember context across renders
      if (data.history) {
        // 🔥 SENIOR FIX: Backend synchronous memory
        setChatHistory(data.history.slice(-15))
      } else {
        setChatHistory(prev => {
          const updated = [...prev, { role: 'user', content: text }, { role: 'assistant', content: data.text || '' }]
          return updated.slice(-15) // Keep last 15 entries approx for rich CRM tasks
        })
      }

      // Show Luis's response text while speaking
      if (data.text) setTranscript(data.text)

      if (data.audioUrl) {
        setState('speaking')
        const audio = new Audio(data.audioUrl)
        currentAudioRef.current = audio
        audio.onended = () => {
          setState('idle')
          setTimeout(() => setTranscript(''), 4000)
        }
        await audio.play()
      } else if (data.useNativeFallback) {
        setState('speaking')
        speakWithNativeFallback(data.text)
      } else {
        setState('idle')
        setTimeout(() => setTranscript(''), 4000)
      }

    } catch (error: unknown) {
      console.error(error)
      setState('idle')
      setTranscript('Error de conexión')
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
      }, 30000) // 30s max — pipeline with tool calls can take longer
    }
    return () => clearTimeout(timer)
  }, [state])

  const isClient = typeof window !== 'undefined'
  
  if (!isClient || !isLoaded || !showLuisFab) return null

  return (
    <>
      {/* ── MOBILE: Draggable Vertical Circle ── */}
      <motion.div 
        drag="y"
        dragConstraints={{ top: -(typeof window !== 'undefined' ? window.innerHeight - 150 : 800), bottom: 20 }}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        style={{ y: springY }}
        className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 sm:hidden touch-none"
      >

        {transcript && state !== 'speaking' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-[200px] px-3 py-2 rounded-xl text-xs text-white/90 leading-snug pointer-events-none"
            style={{ background: 'rgba(5,5,10,0.85)', backdropFilter: 'blur(10px)', border: '1px solid rgba(56,132,255,0.3)' }}
          >
            {transcript.length > 120 ? transcript.slice(0, 120) + '...' : transcript}
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
              ? { background: '#09090b', border: '2px solid rgba(168,85,247,0.8)', boxShadow: '0 0 28px rgba(168,85,247,0.5)' }
              : state === 'processing'
              ? { background: '#2563EB', boxShadow: '0 0 25px rgba(37,99,235,0.6)' }
              : state === 'speaking'
              ? { background: '#09090b', border: '2px solid rgba(56,132,255,0.8)', boxShadow: '0 0 26px rgba(56,132,255,0.5)' }
              : {
                  background: '#09090b',
                  border: '2px solid rgba(56,132,255,0.7)',
                  boxShadow: '0 0 18px rgba(56,132,255,0.4)',
                }
          }
        >
          {state === 'idle' && <Mic className="w-6 h-6" style={{ color: '#3884FF' }} />}
          {state === 'listening' && (
            <VoiceVisualizer isActive={true} volume={volume} isSpeaking={false} />
          )}
          {state === 'processing' && <Loader2 className="w-6 h-6 text-white animate-spin" />}
          {state === 'speaking' && (
            <VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />
          )}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-zinc-700 rounded-full opacity-30" />
        </motion.button>
      </motion.div>

      {/* ── DESKTOP: Premium Pill design ── */}
      <div className="hidden sm:flex fixed top-[72px] right-6 z-50 flex-col items-end gap-3">


        <button
          type="button"
          onClick={toggleRecording}
          title="Asistente Ejecutivo IA — Mantén presionado o clic para hablar"
          className={`relative flex items-center gap-2.5 h-10 px-4 rounded-full transition-all duration-300 font-semibold text-sm select-none ${
            state === 'listening'
              ? 'scale-105'
              : state === 'processing' || state === 'speaking'
              ? ''
              : 'hover:scale-105'
          }`}
          style={
            state === 'listening'
              ? {
                  background: 'rgba(5,5,10,0.9)',
                  color: '#fff',
                  border: '1.5px solid rgba(168,85,247,0.8)',
                  boxShadow: '0 0 22px rgba(168,85,247,0.45), 0 0 50px rgba(236,72,153,0.15)',
                  backdropFilter: 'blur(12px)',
                }
              : state === 'processing'
              ? { background: 'rgba(37,99,235,0.9)', color: '#fff', border: '1.5px solid rgba(37,99,235,0.8)' }
              : state === 'speaking'
              ? {
                  background: 'rgba(5,5,10,0.9)',
                  color: '#fff',
                  border: '1.5px solid rgba(56,132,255,0.8)',
                  boxShadow: '0 0 22px rgba(56,132,255,0.4)',
                  backdropFilter: 'blur(12px)',
                }
              : {
                  background: 'rgba(5,5,10,0.85)',
                  color: '#3884FF',
                  border: '1.5px solid rgba(56,132,255,0.55)',
                  boxShadow: '0 0 18px rgba(56,132,255,0.25), inset 0 0 12px rgba(56,132,255,0.04)',
                  backdropFilter: 'blur(12px)',
                }
          }
        >
          {state === 'idle' && <Mic className="w-4 h-4 flex-shrink-0" />}
          {state === 'listening' && (
            <VoiceVisualizer isActive={true} volume={volume} isSpeaking={false} />
          )}
          {state === 'processing' && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}
          {state === 'speaking' && (
            <VoiceVisualizer isActive={true} volume={0.5} isSpeaking={true} />
          )}

          <span className="leading-none">
            {state === 'idle' && '✦ Luis IA'}
            {state === 'listening' && 'Escuchando...'}
            {state === 'processing' && processingLabel}
            {state === 'speaking' && 'Luis habla...'}
          </span>

          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              state === 'idle' ? 'bg-[#3884FF]' : 'bg-white animate-pulse'
            }`}
          />
        </button>

        {transcript && state !== 'speaking' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-[320px] px-4 py-2.5 rounded-xl text-xs text-white/90 leading-relaxed"
            style={{ background: 'rgba(5,5,10,0.88)', backdropFilter: 'blur(12px)', border: '1px solid rgba(56,132,255,0.25)' }}
          >
            {transcript.length > 200 ? transcript.slice(0, 200) + '...' : transcript}
          </motion.div>
        )}
      </div>
    </>
  )
}
