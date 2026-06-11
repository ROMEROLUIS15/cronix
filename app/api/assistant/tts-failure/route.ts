import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createTracer, shortHash } from '@/lib/ai/observability'
import { logger } from '@/lib/logger'

/**
 * Client-TTS failure beacon.
 *
 * The voice-worker returns `audioUrl: null` and the FAB synthesises speech
 * client-side via `/api/assistant/tts`. When that playback fails (TTS endpoint
 * down, mobile autoplay block, decode error) the owner hears nothing, yet the
 * worker's own trace recorded `success` — the turn looks fine in
 * /dashboard/observability while the user experienced silence. This endpoint
 * lets the FAB report that terminal silence so it shows up in the same panel
 * as a `voice-worker` turn with outcome `failure` / `CLIENT_TTS_FAILED`.
 *
 * Fire-and-forget from the client: always answers 204 and never blocks UX.
 * businessId is resolved from the authenticated user (never trusted from the
 * body) to keep the trace tenant-correct.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single()
  const businessId = profile?.business_id
  if (!businessId) return new NextResponse(null, { status: 403 })

  let body: { text?: unknown; reason?: unknown }
  try { body = await req.json() } catch { body = {} }
  const text   = typeof body.text   === 'string' ? body.text.slice(0, 500)  : ''
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 40) : 'unknown'

  try {
    const tracer  = createTracer({ supabase: createAdminClient() })
    const textSha = await shortHash(text)
    const trace = tracer.start(
      { businessId, channel: 'voice-worker', actorKind: 'user', actorKey: user.id },
      textSha,
      { source: 'client-tts', reason },
    )
    await trace.finish({ outcome: 'failure', errorCode: 'CLIENT_TTS_FAILED', finalTextSha: textSha })
  } catch (err) {
    // Telemetry must never break the caller — log and answer success anyway.
    logger.error('TTS-FAILURE-BEACON', 'failed to record client TTS failure', err)
  }

  return new NextResponse(null, { status: 204 })
}
