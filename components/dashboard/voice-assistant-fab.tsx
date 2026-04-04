'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import type { BusinessSettingsJson } from '@/types'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

export function VoiceAssistantFab() {
  const { supabase, businessId } = useBusinessContext()
  const [state, setState] = useState<AssistantState>('idle')
  const [transcript, setTranscript] = useState<string>('')
  const [isLoaded, setIsLoaded] = useState(false)
  const [showLuisFab, setShowLuisFab] = useState(true)
  
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
          console.error('FAB Visibility Sync Error:', error)
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
      finalTranscriptRef.current = ''
      hasSpokenRef.current = false

      // 1. Get Secure Temp Token
      const tokenRes = await fetch('/api/assistant/token')
      const { token } = await tokenRes.json()
      if (!token) throw new Error('Could not get assistant token')

      // 2. Initialize WebSocket to Deepgram
      const socket = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2-general&language=es&smart_format=true&interim_results=true&endpointing=300')
      socketRef.current = socket

      socket.onopen = () => {
        console.log('Luis IA | WebSocket Connected')
      }

      socket.onmessage = (message) => {
        const received = JSON.parse(message.data)
        const transcriptChunk = received.channel?.alternatives[0]?.transcript
        
        if (transcriptChunk && received.is_final) {
           finalTranscriptRef.current += ' ' + transcriptChunk
           setTranscript(finalTranscriptRef.current.trim())
           hasSpokenRef.current = true
        } else if (transcriptChunk) {
           // Live interim feedback
           setTranscript((finalTranscriptRef.current + ' ' + transcriptChunk).trim())
        }
      }

      socket.onerror = (e) => console.error('Luis IA | WS Error:', e)
      socket.onclose = () => console.log('Luis IA | WS Closed')

      // 3. Audio Stream & MediaRecorder
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
        if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(e.data)
        }
      }

      mediaRecorder.onstop = async () => {
        console.log('Luis IA | Recording stopped')
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }))
          socket.close()
        }
        
        const finalMessage = finalTranscriptRef.current.trim()
        
        if (!hasSpokenRef.current || finalMessage.length < 2) {
          console.warn('Luis IA | Nothing heard')
          setState('idle')
          setTranscript('No te escuché bien...')
          setTimeout(() => setTranscript(''), 2000)
          return
        }

        // 🌟 GHOST TRANSCRIPT: Clear as we start processing
        setTranscript('') 
        await sendTextToAssistant(finalMessage)
      }

      mediaRecorder.start(250) // Send chunks every 250ms

      // 4. VAD Monitoring (Local fallback for safety)
      const SILENCE_THRESHOLD = 10
      const SILENCE_DURATION = 2000
      const MAX_LISTEN_WAIT = 8000
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

  const sendTextToAssistant = async (text: string) => {
    try {
      // 🌟 Optimized: Sending TEXT instead of AUDIO for V5 speed
      const res = await fetch('/api/assistant/voice', { 
        method: 'POST', 
        body: JSON.stringify({ 
          text, 
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone 
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (!res.ok) throw new Error('Servidor no disponible')

      const data = await res.json()
      
      if (data.actionPerformed) {
        window.dispatchEvent(new CustomEvent('cronix:refresh-data'))
      }

      if (data.audioUrl) {
        setState('speaking')
        // GHOST TRANSCRIPT: Ensure it's clear while Luis speaks
        setTranscript('')
        const audio = new Audio(data.audioUrl)
        currentAudioRef.current = audio
        audio.onended = () => {
          setState('idle')
          currentAudioRef.current = null
        }
        audio.onerror = () => speakWithNativeFallback(data.text)
        await audio.play().catch(() => speakWithNativeFallback(data.text))
      } else {
        speakWithNativeFallback(data.text)
      }

    } catch (error: any) {
      console.error(error)
      setState('idle')
      setTranscript(`❌ Error`)
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
            {state === 'processing' && 'Procesando...'}
            {state === 'speaking' && 'Luis habla...'}
          </span>

          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              state === 'idle' ? 'bg-[#3884FF]' : 'bg-white animate-pulse'
            }`}
          />
        </button>
      </div>
    </>
  )
}
