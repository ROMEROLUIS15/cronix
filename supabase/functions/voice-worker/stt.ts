/**
 * Speech-to-text via Deepgram Nova-2.
 *
 * Switched from Groq Whisper because Whisper rejected audio produced by
 * Android Chrome's MediaRecorder. The bytes were valid Opus frames but
 * lacked the WebM container's EBML header (`1a 45 df a3`), so Whisper
 * returned 400 "could not process file - is it a valid media file?".
 *
 * Deepgram Nova-2 is far more permissive — it accepts raw Opus, OGG, WebM,
 * MP4, WAV, MP3 and parses what it gets without strict header validation.
 * This is the same provider used in supabase/functions/process-whatsapp/
 * which has been running in production without STT issues.
 *
 * Required env var (Supabase secret):
 *   DEEPGRAM_AURA_API_KEY  — same key works for Aura (TTS) + Nova-2 (STT)
 *
 * Returns trimmed transcript, or empty string for unintelligible/silent audio.
 */

const DEEPGRAM_KEY = Deno.env.get('DEEPGRAM_AURA_API_KEY')
  ?? Deno.env.get('DEEPGRAM_API_KEY')
  ?? ''

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true'

/**
 * Sniffs the first 16 bytes for known audio magic numbers — used only for
 * diagnostic logging now that Deepgram tolerates anything. Helps us see at
 * a glance whether a problematic recording lacks the expected container.
 */
function detectAudioFormat(head: Uint8Array): string {
  // EBML header (WebM/Matroska): 0x1A 0x45 0xDF 0xA3
  if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) return 'webm'
  // ftyp box (MP4/M4A): bytes 4-7 = 'ftyp'
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4'
  // OggS header
  if (head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return 'ogg'
  // ID3 header (MP3)
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'mp3'
  return 'unknown'
}

export async function transcribe(audio: Blob): Promise<string> {
  if (!DEEPGRAM_KEY) {
    throw new Error('DEEPGRAM_AURA_API_KEY not set')
  }
  if (audio.size === 0) {
    console.warn('[VOICE-WORKER-STT] Empty audio Blob received')
    return ''
  }

  const buf      = await audio.arrayBuffer()
  const head     = new Uint8Array(buf.slice(0, 16))
  const headHex  = Array.from(head).map(b => b.toString(16).padStart(2, '0')).join(' ')
  const detected = detectAudioFormat(head)
  // Use the Blob's declared MIME if present (Deepgram parses it as a hint),
  // otherwise fall back to a generic webm guess.
  const mime     = audio.type || 'audio/webm'

  console.log(`[VOICE-WORKER-STT] Audio: ${audio.size}b, mime=${mime}, container=${detected}, head=${headHex}`)

  // Reject obviously broken audio (< 1 KB is almost always truncated).
  if (audio.size < 1024) {
    console.warn(`[VOICE-WORKER-STT] Audio too small (${audio.size}b) — likely truncated, returning empty`)
    return ''
  }

  const res = await fetch(DEEPGRAM_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Token ${DEEPGRAM_KEY}`,
      'Content-Type': mime,
    },
    body: buf,
  })

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    throw new Error(`Deepgram STT ${res.status}: ${errText}`)
  }

  const data = await res.json() as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string }>
      }>
    }
  }
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
  return transcript.trim()
}
