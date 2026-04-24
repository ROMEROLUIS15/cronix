// ── DASHBOARD AGENT ENDPOINT ──────────────────────────────────────────────────
// Channel: web (owner/employee using the Cronix dashboard)
// Agent:   lib/ai/agents/dashboard/ (prompt + tools + config)
// DO NOT add WhatsApp handling here — WhatsApp lives in supabase/functions/process-whatsapp/
//
// Async flow:
//   1. Validate input, run STT (fast, ~400ms)
//   2. Create Redis job + publish to QStash
//   3. Return { job_id, transcription } immediately (< 1s)
//   4. Worker (/api/assistant/voice/worker) does LLM + TTS in background
//   5. Frontend polls /api/assistant/voice/status?job_id=xxx for result
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Client as QStashClient } from '@upstash/qstash'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'
import { redisRateLimit, isRedisAvailable, markRequestSeen } from '@/lib/rate-limit/redis-rate-limiter'
import { checkTokenQuota } from '@/lib/rate-limit/token-quota'
import { assistantRateLimiter } from '@/lib/api/rate-limit'
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'
import { jobStore } from '@/lib/ai/job-store'
import { randomUUID } from 'crypto'

// ── SCHEMA ────────────────────────────────────────────────────────────────────

const submitPayloadSchema = z.object({
  text:     z.string().max(2000, 'Texto excede longitud máxima permitida').nullable().optional(),
  timezone: z.string().min(2).max(50).default('UTC'),
})

// ── MODULE-LEVEL SINGLETONS ───────────────────────────────────────────────────

const GROQ_API_KEY = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY

function getQStash(): QStashClient | null {
  const token = process.env.QSTASH_TOKEN
  if (!token) return null
  return new QStashClient({ token })
}

const APP_URL = process.env.APP_URL ?? process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : null

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req, _context, _supabase, user) => {

  // 1. Rate limiting (Redis distributed → in-memory fallback)
  const identifier = user.id
  if (isRedisAvailable()) {
    const rl = await redisRateLimit(identifier, 'assistant', 10, 60)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Reintenta en ${rl.retryAfter}s.` },
        { status: 429 },
      )
    }
  } else {
    const { limited, retryAfter } = assistantRateLimiter.isRateLimited(identifier)
    if (limited) {
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Reintenta en ${retryAfter}s.` },
        { status: 429 },
      )
    }
  }

  // 1b. Deduplication
  const requestId = req.headers.get('x-request-id')
  if (requestId && isRedisAvailable()) {
    const isDuplicate = await markRequestSeen(`voice:${identifier}:${requestId}`, 60)
    if (isDuplicate) {
      logger.warn('AI-ASSISTANT', 'Duplicate voice request rejected', { userId: identifier, requestId })
      return NextResponse.json(
        { error: 'Solicitud duplicada. Por favor espera la respuesta anterior.' },
        { status: 409 },
      )
    }
  }

  // 2. Minimum business context (just what we need to validate + enqueue)
  const admin = createAdminClient()
  const repos = getRepos(admin)

  const ctxResult  = await repos.users.getUserContextById(user.id)
  const dbUser     = ctxResult.data
  const businessId = dbUser?.business_id

  if (!businessId) {
    return NextResponse.json({ error: 'No business attached' }, { status: 403 })
  }

  // 2b. Token quota gate — reject before even running STT
  const quota = await checkTokenQuota(businessId)
  if (!quota.allowed) {
    logger.warn('AI-ASSISTANT', `Token quota exceeded: ${quota.used}/${quota.limit}`, { businessId })
    return NextResponse.json(
      { error: 'Límite diario de IA alcanzado. Se reanudará mañana.' },
      { status: 429 },
    )
  }

  // 3. Payload extraction
  let audioFile: Blob | null = null
  let text: string | null = null
  let timezone = 'UTC'

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json() as { text?: string; timezone?: string }
    text     = body.text ?? null
    timezone = body.timezone ?? 'UTC'
  } else {
    const formData = await req.formData()
    audioFile = formData.get('audio') as Blob | null
    timezone  = (formData.get('timezone') as string | null) ?? 'UTC'
  }

  // 4. Zod shield
  try {
    const validated = submitPayloadSchema.parse({ text, timezone })
    text     = validated.text ?? null
    timezone = validated.timezone
  } catch (zodError: unknown) {
    const msg = zodError instanceof Error ? zodError.message : 'Payload inválido'
    logger.warn('AI-ASSISTANT-SHIELD', `Validation breach: ${msg}`)
    return NextResponse.json(
      { error: 'Payload structure is invalid and was blocked by the security shield.' },
      { status: 400 },
    )
  }

  if (!audioFile && !text) {
    return NextResponse.json({ error: 'No input provided (require audio or text)' }, { status: 400 })
  }

  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 })
  }

  // 5. STT — audio transcription (synchronous: blob can't be serialized to QStash)
  let finalText = text ?? ''

  if (audioFile) {
    const sttProvider = new GroqProvider(GROQ_API_KEY)
    const sttStart    = Date.now()

    let sttRes: Awaited<ReturnType<typeof sttProvider.transcribe>>
    try {
      sttRes = await sttProvider.transcribe(audioFile, { language: 'es' })
    } catch (sttErr) {
      logger.error('AI-ASSISTANT-STT', 'Transcription provider threw an error', {
        userId: user.id,
        err:    sttErr instanceof Error ? sttErr.message : String(sttErr),
      })
      return NextResponse.json({
        error: 'Tu audio no se pudo procesar. Por favor intenta de nuevo.',
      }, { status: 500 })
    }

    const sttLatencyMs = Date.now() - sttStart

    if (!sttRes.text?.trim()) {
      logger.warn('AI-ASSISTANT', 'Empty transcription received', { userId: user.id })
      return NextResponse.json({
        error: 'No logré captar lo que dijiste. ¿Podrías repetirlo un poco más claro?',
      }, { status: 422 })
    }

    finalText = sttRes.text.trim()
    logger.info('AI-ASSISTANT-STT', `Escuchado: "${finalText}"`, { userId: user.id, latencyMs: sttLatencyMs })
  }

  // 6. Noise / gibberish guard
  const MEANINGFUL_TEXT = /[a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9]/
  if (finalText.length < 3 || !MEANINGFUL_TEXT.test(finalText)) {
    return NextResponse.json({
      error: 'No entendí bien, ¿puedes repetirlo?',
    }, { status: 422 })
  }

  // 7. Create job in Redis + publish to QStash
  const jobId = randomUUID()

  await jobStore.create(jobId, {
    userId:    user.id,
    businessId,
    timezone,
    inputText: finalText,
  })

  const qstash = getQStash()
  if (!qstash || !APP_URL) {
    logger.error('AI-ASSISTANT', 'QStash not configured — missing QSTASH_TOKEN or APP_URL', { businessId })
    await jobStore.update(jobId, { status: 'failed', error: 'Queue service not configured' })
    return NextResponse.json({ error: 'Servicio de cola no configurado' }, { status: 503 })
  }

  await qstash.publishJSON({
    url:     `${APP_URL}/api/assistant/voice/worker`,
    body:    { job_id: jobId, user_id: user.id, business_id: businessId, timezone, input_text: finalText },
    retries: 4,
  })

  logger.info('AI-ASSISTANT', `Job enqueued`, { jobId, userId: user.id, businessId })

  return NextResponse.json({
    job_id:        jobId,
    status:        'queued',
    transcription: finalText,
  })
})
