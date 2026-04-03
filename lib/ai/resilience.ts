import { logger } from '@/lib/logger'
import { aiCircuit } from './circuit-breaker'

const MAX_RETRIES = 2
const INITIAL_DELAY = 1000 // 1s

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface AIResponse<T> {
  data: T | null
  error?: string
  latency: number
  retries: number
  modelUsed?: string
  circuitTripped?: boolean
}

/**
 * 🛠️ Safe STT (Speech to Text)
 */
export async function safeSTT(
  audioBlob: Blob, 
  apiKey: string, 
  language: string = 'es'
): Promise<AIResponse<{ text: string }>> {
  const start = Date.now()
  if (!aiCircuit.isAvailable('STT')) {
    return { data: null, error: 'STT Circuit Open (Fail Fast)', latency: 0, retries: 0, circuitTripped: true }
  }

  let retryCount = 0
  while (retryCount <= MAX_RETRIES) {
    try {
      const formData = new FormData()
      const ext = audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a') ? 'm4a' : 'webm'
      formData.append('file', audioBlob, `voice.${ext}`)
      formData.append('model', 'whisper-large-v3')
      formData.append('language', language)

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      })

      if (res.ok) {
        aiCircuit.reportSuccess('STT')
        const data = await res.json()
        return { data, latency: Date.now() - start, retries: retryCount, modelUsed: 'whisper-large-v3' }
      }

      const errText = await res.text()
      aiCircuit.reportFailure('STT', errText)
      
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`STT API Error (${res.status}): ${errText}`)
      }
      
      return { data: null, error: errText, latency: Date.now() - start, retries: retryCount }

    } catch (err: any) {
      if (retryCount === MAX_RETRIES) {
        aiCircuit.reportFailure('STT', err.message)
        logger.error('AI-STT', 'Max retries reached', err.message)
        return { data: null, error: err.message, latency: Date.now() - start, retries: retryCount }
      }
      retryCount++
      await sleep(INITIAL_DELAY * Math.pow(2, retryCount))
    }
  }

  return { data: null, error: 'Unknown technical error', latency: Date.now() - start, retries: retryCount }
}

/**
 * 🛠️ Safe LLM (Large Language Model)
 */
export async function safeLLM(
  messages: any[], 
  tools: any[], 
  apiKey: string, 
  primaryModel: string = 'llama-3.3-70b-versatile',
  fallbackModel: string = 'llama-3-8b-8192'
): Promise<AIResponse<any>> {
  const start = Date.now()
  if (!aiCircuit.isAvailable('LLM')) {
    return { data: null, error: 'LLM Circuit Open', latency: 0, retries: 0, circuitTripped: true }
  }

  const execute = async (model: string) => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model, 
        messages, 
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? 'auto' : undefined
      }),
    })
    if (!res.ok) throw { status: res.status, text: await res.text() }
    return await res.json()
  }

  try {
    const data = await execute(primaryModel)
    aiCircuit.reportSuccess('LLM')
    return { data, latency: Date.now() - start, retries: 0, modelUsed: primaryModel }
  } catch (err: any) {
    aiCircuit.reportFailure('LLM', err.text)
    logger.warn('AI-LLM', `Primary model failed, attempting fallback`, err.text)
    
    try {
      const data = await execute(fallbackModel)
      return { data, latency: Date.now() - start, retries: 1, modelUsed: fallbackModel }
    } catch (fallbackErr: any) {
      return { data: null, error: fallbackErr.text, latency: Date.now() - start, retries: 1 }
    }
  }
}

/**
 * 🛠️ Safe TTS (Text to Speech)
 */
export async function safeTTS(
  text: string, 
  apiKey: string, 
  voiceId: string
): Promise<AIResponse<{ audioUrl: string | null; useNativeFallback: boolean }>> {
  const start = Date.now()
  if (!apiKey || !aiCircuit.isAvailable('TTS')) {
    return { data: { audioUrl: null, useNativeFallback: true }, latency: 0, retries: 0, circuitTripped: !apiKey ? false : true }
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    })

    if (!res.ok) {
       const err = await res.text()
       aiCircuit.reportFailure('TTS', err)
       return { data: { audioUrl: null, useNativeFallback: true }, latency: Date.now() - start, retries: 0 }
    }

    aiCircuit.reportSuccess('TTS')
    const buffer = await res.arrayBuffer()
    const audioUrl = `data:audio/mpeg;base64,${Buffer.from(buffer).toString('base64')}`
    
    return { 
      data: { audioUrl, useNativeFallback: false }, 
      latency: Date.now() - start, 
      retries: 0, 
      modelUsed: 'eleven_multilingual_v2' 
    }

  } catch (err: any) {
    aiCircuit.reportFailure('TTS', err.message)
    return { data: { audioUrl: null, useNativeFallback: true }, latency: Date.now() - start, retries: 0 }
  }
}
