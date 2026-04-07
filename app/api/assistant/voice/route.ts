import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'
import { assistantRateLimiter } from '@/lib/api/rate-limit'

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
      tool_calls: z.any().optional() // CRITICAL: LLM requires this array to not crash
    }).passthrough()
  ).max(20, "El historial excede los límites por seguridad").default([])
})

// Infrastructure & Domain
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { DeepgramProvider } from '@/lib/ai/providers/deepgram-provider'
import { AssistantService } from '@/lib/ai/assistant-service'

// ── CONFIG ───────────────────────────────────────────────────────────────
const GROQ_API_KEY     = process.env.LLM_API_KEY || process.env.GROQ_API_KEY
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY

// ── HANDLER ───────────────────────────────────────────────────────────────
export const POST = withErrorHandler(async (req, _context, supabase, user) => {
  
  // 1. Protection: Rate Limiting
  // SECURITY: Only use authenticated user.id — never trust x-forwarded-for (spoofable)
  const identifier = user.id
  const { limited, retryAfter } = assistantRateLimiter.isRateLimited(identifier)
  if (limited) {
    return NextResponse.json(
      { error: `Demasiadas solicitudes. Reintenta en ${retryAfter}s.` },
      { status: 429 }
    )
  }

  // 2. Context: Business Isolation & Identity + Role
  const { data: dbUser } = await supabase
    .from('users')
    .select('business_id, name, role, business:businesses(name)')
    .eq('id', user.id)
    .single()

  const businessId   = dbUser?.business_id
  const businessName = (dbUser?.business as { name: string } | null)?.name || 'tu negocio'
  const userName     = dbUser?.name || 'Usuario'
  const userRole     = (dbUser?.role as string) || 'employee'

  if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

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
    
    // Parse JSON History from FormData
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

  // 5. Platinum Orchestration (Dependency Injection)
  const sttEngine = new GroqProvider(GROQ_API_KEY!)
  const llmEngine = new GroqProvider(GROQ_API_KEY!)
  
  if (!DEEPGRAM_API_KEY) return NextResponse.json({ error: 'TTS provider not configured' }, { status: 500 })
  const ttsEngine = new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-2-nestor-es')

  const assistant = new AssistantService(sttEngine, llmEngine, ttsEngine)

  // 6. Execution (Business Layer)
  const result = await assistant.processVoiceRequest(
    audioFile || text!,
    businessId,
    user.id,
    businessName,
    timezone,
    clientHistory,
    userRole,
    userName
  )

  // 7. Transparent Response
  return NextResponse.json(result)
})
