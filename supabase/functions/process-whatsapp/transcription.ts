/**
 * transcription.ts — Voice-note speech-to-text (Deepgram Nova-2).
 *
 * A standalone concern: takes the raw audio Meta sends and returns text. Kept out of
 * the agent loop so STT lives in one place with its own circuit breaker + retry.
 */

import { addBreadcrumb } from "../_shared/sentry.ts"
import {
  checkCircuitBreaker,
  reportServiceFailure,
  reportServiceSuccess,
} from "./guards.ts"
import { LlmRateLimitError, CircuitBreakerError } from "./groq-client.ts"

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true'

/**
 * Transcribes a voice note buffer to text using Deepgram Nova-2 STT.
 *
 * Provider note: this path migrated from Groq Whisper to Deepgram (Nova-2 accepts
 * the WebM/ogg-opus audio Meta sends without the EBML header Whisper required).
 *
 * @param buffer   - Raw audio bytes (ogg/mp4/webm — whatever Meta sends)
 * @param mimeType - MIME type from Meta (e.g. 'audio/ogg; codecs=opus')
 */
export async function transcribeAudio(buffer: ArrayBuffer, mimeType: string): Promise<{ text: string | null; tokens: number }> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('DEEPGRAM_AURA_API_KEY') ?? Deno.env.get('DEEPGRAM_API_KEY')
  if (!apiKey) throw new Error('DEEPGRAM_AURA_API_KEY no configurada')

  const serviceName = 'DEEPGRAM_STT'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  addBreadcrumb('Calling Deepgram Nova-2 API for STT', 'llm', 'info', { mimeType, byteLength: buffer.byteLength })

  const post = (): Promise<Response> => fetch(DEEPGRAM_URL, {
    method:  'POST',
    headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': mimeType },
    body:    buffer,
  })

  // Deepgram supports raw binary payloads via fetch natively.
  let res: Response
  try {
    res = await post()
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  // Single retry for transient 5xx server errors. Rate-limit (429) and client errors (4xx) are not retried.
  if (!res.ok && res.status >= 500) {
    addBreadcrumb(`Deepgram API ${res.status} on first attempt — retrying once`, 'llm', 'warning')
    try {
      res = await post()
    } catch (retryErr) {
      await reportServiceFailure(serviceName)
      throw retryErr
    }
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
  }

  if (!res.ok) {
    const errBody = await res.text()
    addBreadcrumb(`Deepgram STT error ${res.status}: ${errBody.slice(0, 200)}`, 'llm', 'error', { status: res.status })
    if (res.status >= 500) await reportServiceFailure(serviceName)
    const err = new Error(`Deepgram ${res.status}: ${errBody}`);
    (err as Error & { bufferData?: string }).bufferData = `Len: ${buffer.byteLength}`;
    throw err
  }

  await reportServiceSuccess(serviceName)

  const data = await res.json()
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  const estimatedTokens = transcript ? 50 + transcript.split(/\s+/).length : 0

  return { text: transcript || null, tokens: estimatedTokens }
}
