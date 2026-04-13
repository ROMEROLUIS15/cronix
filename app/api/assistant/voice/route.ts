import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'
import { redisRateLimit, isRedisAvailable, markRequestSeen } from '@/lib/rate-limit/redis-rate-limiter'
import { checkTokenQuota, recordTokenUsage } from '@/lib/rate-limit/token-quota'
import { assistantRateLimiter } from '@/lib/api/rate-limit'
import type { VoiceAssistantContext } from '@/lib/ai/types'

// ── EDGE VALIDATION SCHEMA (ZOD) ──────────────────────────────────────────
const assistantPayloadSchema = z.object({
  text: z.string().max(2000, "Texto excede longitud máxima permitida").nullable().optional(),
  timezone: z.string().min(2).max(50).default('UTC'),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      content: z.string().max(4000).nullable().optional(),
      tool_call_id: z.string().optional(),
      name: z.string().optional(),
      tool_calls: z.any().optional()
    }).passthrough()
  ).max(20, "El historial excede los límites por seguridad").default([])
})

// Infrastructure & Domain
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { DeepgramProvider } from '@/lib/ai/providers/deepgram-provider'
import { AssistantService } from '@/lib/ai/assistant-service'
import { createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'

// ── CONFIG ───────────────────────────────────────────────────────────────
const GROQ_API_KEY     = process.env.LLM_API_KEY || process.env.GROQ_API_KEY
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY

// ── PROVIDER SINGLETONS — reused across requests, no per-request init overhead
const sttEngine  = GROQ_API_KEY     ? new GroqProvider(GROQ_API_KEY)     : null
const llmEngine  = GROQ_API_KEY     ? new GroqProvider(GROQ_API_KEY)     : null
const ttsEngine  = DEEPGRAM_API_KEY ? new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-2-nestor-es') : null
const assistant  = (sttEngine && llmEngine && ttsEngine)
  ? new AssistantService(sttEngine, llmEngine, ttsEngine)
  : null

// ── HANDLER ───────────────────────────────────────────────────────────────
export const POST = withErrorHandler(async (req, _context, supabase, user) => {

  // 1. Protection: Rate Limiting (Redis distributed → in-memory fallback)
  const identifier = user.id
  if (isRedisAvailable()) {
    const result = await redisRateLimit(identifier, 'assistant', 10, 60)
    if (!result.allowed) {
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Reintenta en ${result.retryAfter}s.` },
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

  // 1b. Deduplication — prevent double-execution when the client retries the same request.
  // The client must set x-request-id to a stable UUID for the lifetime of the request.
  // A second request with the same (userId, requestId) within 60 s is rejected with 409.
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

  // 2. Context: Business Isolation & Identity + Role
  // Use admin client to bypass RLS on users table (same pattern as dashboard layout).
  // The regular client can return null due to RLS policy recursion on some accounts.
  const admin = createAdminClient()
  const { users: usersRepoInstance, businesses: businessesRepoInstance } = getRepos(admin)
  const ctxResult = await usersRepoInstance.getUserContextById(user.id)
  const dbUser = ctxResult.data

  const businessId   = dbUser?.business_id
  const businessNameResult = businessId ? await businessesRepoInstance.getById(businessId) : { data: null }
  const businessName = businessNameResult.data?.name || 'tu negocio'
  const userName     = dbUser?.name || 'Usuario'
  const userRole     = (dbUser?.role as string) || 'employee'

  if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

  // 2b. Token Quota — prevents runaway LLM costs
  const quota = await checkTokenQuota(businessId)
  if (!quota.allowed) {
    logger.warn('AI-ASSISTANT', `Token quota exceeded: ${quota.used}/${quota.limit}`, { businessId })
    return NextResponse.json(
      { error: 'Límite diario de IA alcanzado. Se reanudará mañana.' },
      { status: 429 },
    )
  }

  // 3. Payload Extraction & Input Switch
  let audioFile: Blob | null = null
  let text: string | null = null
  let timezone = 'UTC'
  let clientHistory: any[] = []

  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await req.json()
    text = body.text
    timezone = body.timezone || 'UTC'
    clientHistory = body.history || []
  } else {
    const formData = await req.formData()
    audioFile = formData.get('audio') as Blob | null
    timezone = formData.get('timezone') as string || 'UTC'

    const historyString = formData.get('history') as string
    if (historyString) {
      try {
        clientHistory = JSON.parse(historyString)
      } catch (e) {
        logger.warn('AI-ASSISTANT', 'Could not parse history from FormData')
      }
    }
  }

  // 4. Input Shielding (Zod Parsing)
  try {
    const validated = assistantPayloadSchema.parse({
      text: text,
      timezone: timezone,
      history: clientHistory
    })
    text = validated.text ?? null
    timezone = validated.timezone
    clientHistory = validated.history
  } catch (zodError: any) {
    logger.warn('AI-ASSISTANT-SHIELD', `Validation breach attempt: ${zodError.message}`)
    return NextResponse.json({ error: 'Payload structure is invalid and was blocked by the security shield.' }, { status: 400 })
  }

  if (!audioFile && !text) {
    return NextResponse.json({ error: 'No input provided (require audio or text)' }, { status: 400 })
  }

  // 5. Platinum Orchestration — singleton initialized at module level
  if (!DEEPGRAM_API_KEY) return NextResponse.json({ error: 'TTS provider not configured' }, { status: 500 })
  if (!assistant) return NextResponse.json({ error: 'AI service not initialized' }, { status: 500 })

  // 6. Execution (Business Layer)
  const context: VoiceAssistantContext = {
    businessId,
    userId: user.id,
    businessName,
    userTimezone: timezone,
    userRole: userRole as VoiceAssistantContext['userRole'],
    userName,
    requestId: req.headers.get('x-request-id') ?? undefined,
  }
  const result = await assistant.processVoiceRequest(audioFile || text!, context)

  // 7. Record token usage (fire-and-forget — non-blocking)
  if (result.debug?.steps) {
    // Estimate: ~4 tokens per word, ~1 token per 4 chars
    const inputTokens = text ? Math.ceil(text.length / 4) : 0
    const outputTokens = result.text ? Math.ceil(result.text.length / 4) : 0
    const totalTokens = inputTokens + outputTokens + result.debug.steps * 50 // steps include tool calls

    void recordTokenUsage(businessId, totalTokens)
  }

  return NextResponse.json(result)
})
