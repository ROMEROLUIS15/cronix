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

/**
 * Char cap for TTS. Bumped from 220 to 800 because the previous limit
 * truncated long appointment lists ("Tienes 8 citas: ..." → cut at 4th).
 * 800 chars ≈ 30 short list items, ≈ 60s of speech — well within
 * Deepgram Aura's per-request capacity and acceptable for voice UX.
 */
const MAX_TTS_CHARS = 800

/**
 * Truncate at a natural boundary before MAX_TTS_CHARS so the audio doesn't
 * end mid-word. Boundary preference (best → worst):
 *   1. Sentence end (. ? !) — only if past 100 chars (avoids cutting too early)
 *   2. Newline — for lists where each line is one item; safe to cut between items
 *   3. Hard cut at MAX_TTS_CHARS — last resort
 */
function truncateForTts(text: string): string {
  if (text.length <= MAX_TTS_CHARS) return text
  const cut = text.slice(0, MAX_TTS_CHARS)

  const lastSentence = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('?'),
    cut.lastIndexOf('!'),
  )
  if (lastSentence > 100) return text.slice(0, lastSentence + 1)

  const lastNewline = cut.lastIndexOf('\n')
  if (lastNewline > 100) return text.slice(0, lastNewline)

  return cut
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
