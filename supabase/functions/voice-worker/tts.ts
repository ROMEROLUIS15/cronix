/**
 * Text-to-speech via Deepgram Aura.
 *
 * Returns a base64 data: URL that the FAB can play directly with `new Audio()`.
 * No streaming, no caching — this is the single-shot synth call.
 *
 * Required env var (Supabase secret):
 *   DEEPGRAM_AURA_API_KEY
 *
 * Returns null on any failure so the worker falls through to text-only response.
 */

const DEEPGRAM_KEY   = Deno.env.get('DEEPGRAM_AURA_API_KEY') ?? ''
const DEEPGRAM_MODEL = 'aura-2-nestor-es'  // Spanish male voice
const MAX_TTS_CHARS  = 220                  // cap to keep latency low

/**
 * Truncate at the last sentence boundary before MAX_TTS_CHARS so the audio
 * doesn't end mid-word. Falls back to a hard cut if no sentence break is near.
 */
function truncateForTts(text: string): string {
  if (text.length <= MAX_TTS_CHARS) return text
  const cut = text.slice(0, MAX_TTS_CHARS)
  const lastBoundary = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('?'),
    cut.lastIndexOf('!'),
  )
  return lastBoundary > 80 ? text.slice(0, lastBoundary + 1) : cut
}

export async function synthesizeAudio(text: string): Promise<string | null> {
  if (!DEEPGRAM_KEY || !text?.trim()) return null

  try {
    const truncated = truncateForTts(text)
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${DEEPGRAM_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: truncated }),
    })

    if (!res.ok) {
      console.warn(`[VOICE-WORKER-TTS] Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return null
    }

    const buffer = await res.arrayBuffer()
    const b64    = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    return `data:audio/mpeg;base64,${b64}`
  } catch (err) {
    console.warn(`[VOICE-WORKER-TTS] Synthesis threw: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
