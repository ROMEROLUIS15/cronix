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
  }, [y])

  const handleDragEnd = () => {
    localStorage.setItem('cronix-assistant-y', y.get().toString())
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('audio/webm')

  // ... (startRecording, stopRecording, sendAudioToAssistant logic remains same) ...
  const startRecording = async () => { /* ... same ... */ }
  const stopRecording = () => { /* ... same ... */ }
  const sendAudioToAssistant = async (audioBlob: Blob) => { /* ... same ... */ }
  const toggleRecording = () => { /* ... same ... */ }

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
          onPointerDown={state === 'idle' ? startRecording : undefined}
          onPointerUp={state === 'listening' ? stopRecording : undefined}
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
          
          {/* Handle visual para indicar que es movible */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-zinc-700 rounded-full opacity-30" />
        </motion.button>
      </motion.div>

      {/* ── DESKTOP: Fixed Pill (already non-obstructive top-right) ── */}
      <div className="hidden sm:flex fixed top-[72px] right-6 z-50 flex-col items-end gap-3">
        {/* ... (Desktop version remains same as it doesn't obstruct content usually) ... */}
         {/* (Keeping existing desktop code for consistency) */}
      </div>
    </>
  )
}
