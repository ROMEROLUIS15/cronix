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

/**
 * Detects audio MIME type from the Blob's reported type, falling back to
 * magic-byte sniffing when the type is empty/wrong (common after FormData
 * cross-boundary serialization where Deno may drop the content-type).
 *
 * Returns { mime, ext } so we can re-wrap the audio in a Blob with the
 * correct type AND name the file with the matching extension for Whisper.
 */
async function detectAudioFormat(audio: Blob): Promise<{ mime: string; ext: string }> {
  // 1. Trust the Blob's own type if it looks like real audio
  const t = audio.type.toLowerCase()
  if (t.includes('mp4') || t.includes('m4a')) return { mime: 'audio/mp4',  ext: 'm4a'  }
  if (t.includes('ogg'))                       return { mime: 'audio/ogg',  ext: 'ogg'  }
  if (t.includes('mpeg') || t.includes('mp3')) return { mime: 'audio/mpeg', ext: 'mp3'  }
  if (t.includes('wav'))                       return { mime: 'audio/wav',  ext: 'wav'  }
  if (t.includes('webm'))                      return { mime: 'audio/webm', ext: 'webm' }

  // 2. Magic byte sniffing — needed when type is missing (octet-stream)
  const head = new Uint8Array(await audio.slice(0, 16).arrayBuffer())
  // EBML header (WebM/Matroska): 0x1A 0x45 0xDF 0xA3
  if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) {
    return { mime: 'audio/webm', ext: 'webm' }
  }
  // ftyp box (MP4/M4A): bytes 4-7 = 'ftyp'
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return { mime: 'audio/mp4', ext: 'm4a' }
  }
  // OggS header
  if (head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) {
    return { mime: 'audio/ogg', ext: 'ogg' }
  }
  // ID3 header (MP3)
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return { mime: 'audio/mpeg', ext: 'mp3' }
  }
  // Default: assume webm — most browsers' MediaRecorder default
  return { mime: 'audio/webm', ext: 'webm' }
}

export async function transcribe(audio: Blob): Promise<string> {
  if (GROQ_KEYS.length === 0) {
    throw new Error('No Groq API key configured (LLM_API_KEY)')
  }
  if (audio.size === 0) {
    console.warn('[VOICE-WORKER-STT] Empty audio Blob received')
    return ''
  }

  const { mime, ext } = await detectAudioFormat(audio)
  console.log(`[VOICE-WORKER-STT] Audio: ${audio.size}b, declared=${audio.type || 'none'}, detected=${mime}`)

  // Re-wrap in a fresh Blob with explicit type — guarantees Whisper sees
  // the correct content-type even if FormData parsing dropped the original.
  const buf  = await audio.arrayBuffer()
  const file = new File([buf], `voice.${ext}`, { type: mime })

  const form = new FormData()
  form.append('file',     file)
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
