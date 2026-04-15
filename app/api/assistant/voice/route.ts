import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'
import { redisRateLimit, isRedisAvailable, markRequestSeen } from '@/lib/rate-limit/redis-rate-limiter'
import { checkTokenQuota, recordTokenUsage } from '@/lib/rate-limit/token-quota'
import { assistantRateLimiter } from '@/lib/api/rate-limit'
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { DeepgramProvider } from '@/lib/ai/providers/deepgram-provider'
import { shieldOutput } from '@/lib/ai/output-shield'
import { createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'
import { createProductionOrchestrator } from '@/lib/ai/orchestrator/orchestrator-factory'
import type { AiInput, UserRole } from '@/lib/ai/orchestrator'
import type { LlmMessage } from '@/lib/ai/providers/types'

// ── SCHEMA ────────────────────────────────────────────────────────────────────

const assistantPayloadSchema = z.object({
  text: z.string().max(2000, 'Texto excede longitud máxima permitida').nullable().optional(),
  timezone: z.string().min(2).max(50).default('UTC'),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      content: z.string().max(4000).nullable().optional(),
      tool_call_id: z.string().optional(),
      name: z.string().optional(),
      tool_calls: z.any().optional(),
    }).passthrough()
  ).max(20, 'El historial excede los límites por seguridad').default([]),
})

// ── MODULE-LEVEL SINGLETONS ────────────────────────────────────────────────────
// Only TTS and keys — no AssistantService.

const GROQ_API_KEY     = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY

const ttsEngine = DEEPGRAM_API_KEY
  ? new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-2-nestor-es')
  : null

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req, _context, _supabase, user) => {

  // 1. Rate Limiting (Redis distributed → in-memory fallback)
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

  // 2. Business context
  const admin = createAdminClient()
  const repos = getRepos(admin)
  const { users: usersRepo, businesses: businessesRepo } = repos

  const ctxResult  = await usersRepo.getUserContextById(user.id)
  const dbUser     = ctxResult.data
  const businessId = dbUser?.business_id
  const userName   = dbUser?.name ?? 'Usuario'
  const userRole   = (dbUser?.role as string) ?? 'employee'

  // Fetch full business row: name + settings JSON (single call, no extra query)
  let businessName = 'tu negocio'
  let aiRules: string | undefined
  let workingHours: Record<string, { open: string; close: string }> | undefined
  if (businessId) {
    const bizRes  = await businessesRepo.getById(businessId)
    const bizData = bizRes.data
    businessName  = bizData?.name ?? 'tu negocio'
    const settings = (bizData?.settings ?? null) as Record<string, unknown> | null
    aiRules      = typeof settings?.aiRules === 'string' ? settings.aiRules : undefined
    workingHours = settings?.workingHours as Record<string, { open: string; close: string }> | undefined
  }

  if (!businessId) {
    return NextResponse.json({ error: 'No business attached' }, { status: 403 })
  }

  // 2b. Token quota
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
  let clientHistory: unknown[] = []

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json() as { text?: string; timezone?: string; history?: unknown[] }
    text          = body.text ?? null
    timezone      = body.timezone ?? 'UTC'
    clientHistory = body.history ?? []
  } else {
    const formData = await req.formData()
    audioFile = formData.get('audio') as Blob | null
    timezone  = (formData.get('timezone') as string | null) ?? 'UTC'
    const histStr = formData.get('history') as string | null
    if (histStr) {
      try { clientHistory = JSON.parse(histStr) as unknown[] } catch { /* ignore */ }
    }
  }

  // 4. Zod shield
  try {
    const validated   = assistantPayloadSchema.parse({ text, timezone, history: clientHistory })
    text          = validated.text ?? null
    timezone      = validated.timezone
    clientHistory = validated.history
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

  // 5. STT — audio transcription (stays in route, not orchestrator's job)
  let finalText = text ?? ''
  let sttLatencyMs = 0

  if (audioFile) {
    const sttProvider = new GroqProvider(GROQ_API_KEY)
    const sttStart    = Date.now()
    const sttRes      = await sttProvider.transcribe(audioFile, { language: 'es' })
    sttLatencyMs      = Date.now() - sttStart

    if (!sttRes.text?.trim()) {
      logger.warn('AI-ASSISTANT', 'Empty transcription received', { userId: user.id })
      return NextResponse.json({
        text: 'No logré captar lo que dijiste. ¿Podrías repetirlo un poco más claro?',
        audioUrl: null,
        useNativeFallback: true,
        actionPerformed: false,
      })
    }

    finalText = sttRes.text.trim()
    logger.info('AI-ASSISTANT-STT', `Escuchado: "${finalText}"`, { userId: user.id, latencyMs: sttLatencyMs })
  }

  // 6. Load business context for LLM
  // Services: LLM needs names + UUIDs to resolve user-spoken service names.
  // Today's appointments: LLM needs IDs to cancel/reschedule same-day bookings.
  // Future appointments are fetched on-demand via get_appointments_by_date tool.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const [servicesRes, todayApptRes] = await Promise.all([
    repos.services.getActive(businessId),
    repos.appointments.getDayAppointments(businessId, todayStr),
  ])

  const aiInput: AiInput = {
    text:       finalText,
    userId:     user.id,
    businessId,
    userRole:   (userRole as UserRole),
    timezone,
    channel:    'web',
    history:    clientHistory as LlmMessage[],
    requestId:  requestId ?? undefined,
    userName,
    context: {
      businessId,
      businessName,
      timezone,
      aiRules,
      workingHours,
      services: (servicesRes.data ?? []).map((s) => ({
        id:           s.id,
        name:         s.name,
        duration_min: s.duration_min,
        price:        s.price,
      })),
      activeAppointments: (todayApptRes.data ?? [])
        .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
        .map((a) => ({
          id:          a.id,
          serviceName: (a.service as { name: string } | null)?.name ?? '',
          clientName:  (a.client as { name: string } | null)?.name ?? '',
          startAt:     a.start_at,
          endAt:       a.end_at,
          status:      a.status ?? 'pending',
        })),
    },
  }

  const orchestrator = createProductionOrchestrator(admin, GROQ_API_KEY)
  const output = await orchestrator.process(aiInput)

  // 7. Token usage (fire-and-forget)
  void recordTokenUsage(businessId, output.tokens)

  // 8. TTS
  let audioUrl: string | null = null
  let ttsLatencyMs = 0

  if (ttsEngine && output.text) {
    // Shield before vocalizing — prevents jailbroken text from being spoken
    const shielded = shieldOutput(output.text, user.id)

    // Truncate to first ~220 chars at a sentence boundary for lower TTS latency
    const ttsInput = (() => {
      if (shielded.length <= 220) return shielded
      const cut     = shielded.slice(0, 220)
      const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'))
      return lastDot > 80 ? shielded.slice(0, lastDot + 1) : cut
    })()

    const ttsStart = Date.now()
    const ttsRes   = await ttsEngine.synthesize(ttsInput)
    ttsLatencyMs   = Date.now() - ttsStart
    audioUrl       = ttsRes.audioUrl ?? null
  }

  logger.metric({
    requestId:    requestId ?? 'unknown',
    businessId,
    userId:       user.id,
    sttLatencyMs,
    ttsLatencyMs,
    llmSteps:     output.toolTrace.length,
    intentSource: 'react',
    toolsUsed:    output.toolTrace.map((t) => t.tool),
    totalMs:      sttLatencyMs + ttsLatencyMs,
  })

  return NextResponse.json({
    text:              output.text,
    audioUrl,
    useNativeFallback: !audioUrl,
    actionPerformed:   output.actionPerformed,
    history:           output.history,
  })
})
