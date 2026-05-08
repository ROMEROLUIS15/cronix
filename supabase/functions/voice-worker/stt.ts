/**
 * Speech-to-text via Groq Whisper.
 *
 * Receives the raw audio Blob from the FAB, returns the transcribed text.
 * No retries — Whisper is reliable; if it fails the user just retries.
 *
 * Required env var (Supabase secret):
 *   LLM_API_KEY  (Groq API key — supports comma-separated keys, first is used)
 *
 * Throws on transport errors so the caller can surface a 500. Returns empty
 * string for "couldn't understand" so the caller can ask the user to repeat.
 */

const GROQ_KEYS = (Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY') ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)

const STT_MODEL = 'whisper-large-v3-turbo'

export async function transcribe(audio: Blob): Promise<string> {
  if (GROQ_KEYS.length === 0) {
    throw new Error('No Groq API key configured (LLM_API_KEY)')
  }
  if (audio.size === 0) return ''

  const ext = audio.type.includes('mp4') || audio.type.includes('m4a') ? 'm4a' : 'webm'

  const form = new FormData()
  form.append('file',     audio, `voice.${ext}`)
  form.append('model',    STT_MODEL)
  form.append('language', 'es')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${GROQ_KEYS[0]}` },
    body:    form,
  })

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    throw new Error(`Groq Whisper ${res.status}: ${errText}`)
  }

  const data = await res.json() as { text?: string }
  return (data.text ?? '').trim()
}
