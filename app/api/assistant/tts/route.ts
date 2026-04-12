import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

/**
 * GET /api/assistant/tts?text=...
 *
 * Streams Deepgram Aura-2 audio directly to the browser.
 * The browser can start playing as soon as the first bytes arrive —
 * no need to wait for the full audio buffer (eliminates base64 round-trip overhead).
 *
 * Latency reduction vs base64 approach:
 *   base64: wait full synthesis → encode → JSON → transfer → decode → play
 *   stream: first byte → browser plays immediately while rest downloads
 */
export async function GET(req: NextRequest) {
  // Auth: verify session before serving audio
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const text = req.nextUrl.searchParams.get('t')
  if (!text || text.trim().length === 0) {
    return new NextResponse('Missing text', { status: 400 })
  }

  const apiKey = process.env.DEEPGRAM_AURA_API_KEY
  if (!apiKey) return new NextResponse('TTS not configured', { status: 503 })

  const decodedText = decodeURIComponent(text).slice(0, 500)

  try {
    const dgRes = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-nestor-es', {
      method:  'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: decodedText }),
    })

    if (!dgRes.ok || !dgRes.body) {
      logger.error('TTS-STREAM', `Deepgram error ${dgRes.status}`)
      return new NextResponse('TTS error', { status: 502 })
    }

    // Pipe Deepgram response body directly — zero buffering on the server side
    return new NextResponse(dgRes.body, {
      status: 200,
      headers: {
        'Content-Type':  'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no', // Disable nginx buffering if present
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('TTS-STREAM', `Stream failed: ${msg}`)
    return new NextResponse('Stream error', { status: 500 })
  }
}
