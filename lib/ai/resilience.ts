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
      formData.append('model', 'whisper-large-v3-turbo')
      formData.append('language', language)

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      })

      if (res.ok) {
        aiCircuit.reportSuccess('STT')
        const data = await res.json()
        return { data, latency: Date.now() - start, retries: retryCount, modelUsed: 'whisper-large-v3-turbo' }
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
  primaryModel: string = 'llama-3.1-8b-instant',
  fallbackModel: string = 'llama-3.3-70b-versatile'
): Promise<AIResponse<any>> {
  const start = Date.now()
  if (!aiCircuit.isAvailable('LLM')) {
    return { data: null, error: 'LLM Circuit Open', latency: 0, retries: 0, circuitTripped: true }
  }

  const execute = async (model: string) => {
    // max_tokens split by use case:
    // - With tools (planner/ReAct): 300 tokens — tool_call JSON can be 100-200 tokens alone;
    //   100 was causing truncation and silent fallback to plain text.
    // - Without tools (quality tier text): 100 tokens — voice response is 2-3 sentences max;
    //   keeping it low prevents long TTS synthesis latency downstream.
    const maxTokens = tools.length ? 300 : 100

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.1,
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
        voice_settings: { stability: 0.8, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
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
    logger.error('AI-TTS', `Unexpected TTS failure: ${err.message}`, { stack: err.stack })
    return { data: { audioUrl: null, useNativeFallback: true }, latency: Date.now() - start, retries: 0 }
  }
}
/**
 * 🛠️ Safe Deepgram TTS (Aura)
 */
export async function safeDeepgramTTS(
  text: string, 
  apiKey: string, 
  model: string = 'aura-2-nestor-es' // REVERTED TO NESTOR (STABLE SPANISH MALE)
): Promise<AIResponse<{ audioUrl: string | null; useNativeFallback: boolean }>> {
  const start = Date.now()
  logger.info('AI-TTS-DEEPGRAM', `Attempting synthesis with model: ${model}`)
  
  if (!apiKey || !aiCircuit.isAvailable('TTS')) {
    logger.warn('AI-TTS-DEEPGRAM', 'API Key missing or Circuit Tripped')
    return { data: { audioUrl: null, useNativeFallback: true }, latency: 0, retries: 0, circuitTripped: !apiKey ? false : true }
  }

  try {
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
       const err = await res.text()
       aiCircuit.reportFailure('TTS', err)
       logger.error('AI-TTS-DEEPGRAM', `API Failure: ${res.status} | Model: ${model} | Error: ${err}`)
       return { data: { audioUrl: null, useNativeFallback: true }, latency: Date.now() - start, retries: 0 }
    }

    aiCircuit.reportSuccess('TTS')
    const buffer = await res.arrayBuffer()
    const audioUrl = `data:audio/mpeg;base64,${Buffer.from(buffer).toString('base64')}`
    
    logger.info('AI-TTS-DEEPGRAM', 'Synthesis successful', { latency: Date.now() - start })

    return { 
      data: { audioUrl, useNativeFallback: false }, 
      latency: Date.now() - start, 
      retries: 0, 
      modelUsed: model 
    }

  } catch (err: any) {
    aiCircuit.reportFailure('TTS', err.message)
    logger.error('AI-TTS-DEEPGRAM', `Critical Exception: ${err.message}`)
    return { data: { audioUrl: null, useNativeFallback: true }, latency: Date.now() - start, retries: 0 }
  }
}
