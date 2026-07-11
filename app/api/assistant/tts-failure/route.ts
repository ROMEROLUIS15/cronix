import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createTracer, shortHash } from '@/lib/ai/observability'
import { isUserRateLimited, ASSISTANT_LIMITS } from '@/lib/rate-limit/user-rate-limit'
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

  // Light per-user cap so a misbehaving client can't spam the trace table.
  // Preserve the fire-and-forget contract: silently drop (204), never 429.
  if (await isUserRateLimited(user.id, ASSISTANT_LIMITS.ttsFailure)) {
    return new NextResponse(null, { status: 204 })
  }

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
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 80) : 'unknown'

  // reason is "<kind>|http=<status>" (e.g. "never-started|http=200"). Break it
  // into structured fields so the dashboard can tell autoplay blocks (http=200)
  // apart from endpoint failures (401/502/503) without parsing strings.
  const m = /^([a-z-]+)\|http=(\d+)$/.exec(reason)
  const detail = m
    ? { source: 'client-tts', reason, ttsKind: m[1], ttsHttpStatus: Number(m[2]) }
    : { source: 'client-tts', reason }

  try {
    const tracer  = createTracer({ supabase: createAdminClient() })
    const textSha = await shortHash(text)
    const trace = tracer.start(
      { businessId, channel: 'voice-worker', actorKind: 'user', actorKey: user.id },
      textSha,
      detail,
    )
    await trace.finish({ outcome: 'failure', errorCode: 'CLIENT_TTS_FAILED', finalTextSha: textSha })
  } catch (err) {
    // Telemetry must never break the caller — log and answer success anyway.
    logger.error('TTS-FAILURE-BEACON', 'failed to record client TTS failure', err)
  }

  return new NextResponse(null, { status: 204 })
}
