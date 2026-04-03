import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { logger } from '@/lib/logger'
import { assistantRateLimiter } from '@/lib/api/rate-limit'

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
  const identifier = user.id || req.headers.get('x-forwarded-for') || 'anonymous'
  const { limited, retryAfter } = assistantRateLimiter.isRateLimited(identifier)
  if (limited) {
    return NextResponse.json(
      { error: `Demasiadas solicitudes. Reintenta en ${retryAfter}s.` },
      { status: 429 }
    )
  }

  // 2. Context: Business Isolation & Identity
  const { data: dbUser } = await supabase
    .from('users')
    .select('business_id, business:businesses(name)')
    .eq('id', user.id)
    .single()
  
  const businessId = dbUser?.business_id
  const businessName = (dbUser?.business as any)?.name || 'tu negocio'
  
  if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

  // 3. Payload Extraction
  const formData = await req.formData()
  const audioFile = formData.get('audio') as Blob | null
  const timezone = formData.get('timezone') as string || 'UTC'
  
  if (!audioFile) return NextResponse.json({ error: 'No audio provided' }, { status: 400 })

  // 4. Platinum Orchestration (Dependency Injection)
  const sttEngine = new GroqProvider(GROQ_API_KEY!)
  const llmEngine = new GroqProvider(GROQ_API_KEY!)
  
  // PRIMARY TTS: Deepgram Aura 2 — nestor-es (ultra-low latency Spanish male voice)
  if (!DEEPGRAM_API_KEY) return NextResponse.json({ error: 'TTS provider not configured' }, { status: 500 })
  const ttsEngine = new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-2-nestor-es')

  logger.info('AI-VOICE', 'Starting synthesis', { 
    engine: 'Deepgram',
    userId: user.id,
    timezone 
  })

  const assistant = new AssistantService(sttEngine, llmEngine, ttsEngine)

  // 5. Execution
  const result = await assistant.processVoiceRequest(audioFile, businessId, user.id, businessName, timezone)

  // 6. Transparent Response
  return NextResponse.json(result)
})
