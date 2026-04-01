'use client'

import React, { useState, useRef } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking'

export function VoiceAssistantFab() {
  const [state, setState] = useState<AssistantState>('idle')
  const [transcript, setTranscript] = useState<string>('')
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await sendAudioToAssistant(audioBlob)
      }

      mediaRecorder.start()
      setState('listening')
      setTranscript('')
    } catch (err) {
      console.error('Error accessing microphone', err)
      alert('Error de acceso al micrófono. Por favor permite el acceso en tu navegador.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && state === 'listening') {
      mediaRecorderRef.current.stop()
      setState('processing')
      // Detener cada track del stream para soltar el micrófono (evitar punto rojo en navegador)
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
    }
  }

  const sendAudioToAssistant = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const res = await fetch('/api/assistant/voice', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Error en procesamiento de audio')

      const data = await res.json()
      setTranscript(data.text)
      
      if (data.audioUrl) {
        // ElevenLabs: reproducir MP3 real
        setState('speaking')
        const audio = new Audio(data.audioUrl)
        audio.onended = () => {
          setState('idle')
          setTimeout(() => setTranscript(''), 4000)
        }
        audio.onerror = () => {
          setState('idle')
          setTimeout(() => setTranscript(''), 4000)
        }
        await audio.play().catch(console.error)
      } else {
        // Fallback: voz nativa del navegador
        setState('speaking')
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(data.text)
          u.lang = 'es-419'
          u.rate = 1.05
          u.onend = () => { setState('idle'); setTimeout(() => setTranscript(''), 4000) }
          window.speechSynthesis.speak(u)
        } else {
          setState('idle')
          setTimeout(() => setTranscript(''), 5000)
        }
      }

    } catch (error) {
      console.error(error)
      setState('idle')
      setTranscript('❌ Error procesando solicitud.')
      setTimeout(() => setTranscript(''), 3000)
    }
  }

  const toggleRecording = () => {
    if (state === 'idle') startRecording()
    else if (state === 'listening') stopRecording()
  }

  // Prevenir que se muestre si no es cliente
  const isClient = typeof window !== 'undefined'
  if (!isClient) return null

  return (
    <>
      {/* ── MOBILE: círculo abajo a la derecha (alcance del pulgar) ── */}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2 sm:hidden">
        {transcript && (
          <div className="bg-zinc-900 border border-zinc-800 text-white text-sm px-4 py-3 rounded-2xl shadow-xl max-w-xs animate-in slide-in-from-bottom-2 fade-in duration-300">
            <p className="leading-snug">{transcript}</p>
          </div>
        )}
        <button
          type="button"
          onPointerDown={state === 'idle' ? startRecording : undefined}
          onPointerUp={state === 'listening' ? stopRecording : undefined}
          onClick={toggleRecording}
          title="Asistente IA"
          className="relative flex items-center justify-center w-14 h-14 rounded-full shadow-2xl transition-all duration-300"
          style={
            state === 'listening'
              ? { background: '#EF4444', transform: 'scale(1.1)', boxShadow: '0 0 20px rgba(239,68,68,0.6)' }
              : state === 'processing' || state === 'speaking'
              ? { background: '#2563EB', boxShadow: '0 0 20px rgba(37,99,235,0.6)' }
              : {
                  background: '#000',
                  border: '2px solid rgba(56,132,255,0.7)',
                  boxShadow: '0 0 18px rgba(56,132,255,0.4), inset 0 0 10px rgba(56,132,255,0.08)',
                }
          }
        >
          {state === 'listening' && (
            <span className="absolute inset-0 rounded-full bg-red-400 opacity-50 animate-ping" />
          )}
          {state === 'idle' && <Mic className="w-6 h-6" style={{ color: '#3884FF' }} />}
          {state === 'listening' && <Square className="w-5 h-5 text-white fill-current" />}
          {(state === 'processing' || state === 'speaking') && <Loader2 className="w-6 h-6 text-white animate-spin" />}
        </button>
      </div>

      {/* ── DESKTOP / LAPTOP: píldora superior-derecha premium ── */}
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
          onPointerDown={state === 'idle' ? startRecording : undefined}
          onPointerUp={state === 'listening' ? stopRecording : undefined}
          onClick={toggleRecording}
          title="Asistente Ejecutivo IA — Mantén presionado para hablar"
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

          {/* Dot indicador de estado */}
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
