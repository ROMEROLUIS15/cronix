import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { assistantRateLimiter } from '@/lib/api/rate-limit'

// Infrastructure & Domain
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { ElevenLabsProvider } from '@/lib/ai/providers/elevenlabs-provider'
import { AssistantService } from '@/lib/ai/assistant-service'

// ── CONFIG ───────────────────────────────────────────────────────────────
const GROQ_API_KEY       = process.env.LLM_API_KEY || process.env.GROQ_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_VOICE   = process.env.ELEVENLABS_VOICE_ID

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

  // 2. Context: Business Isolation
  const { data: dbUser } = await supabase.from('users').select('business_id').eq('id', user.id).single()
  const businessId = dbUser?.business_id
  if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

  // 3. Payload Extraction
  const formData = await req.formData()
  const audioFile = formData.get('audio') as Blob | null
  if (!audioFile) return NextResponse.json({ error: 'No audio provided' }, { status: 400 })

  // 4. Platinum Orchestration (Dependency Injection)
  const sttEngine = new GroqProvider(GROQ_API_KEY!)
  const llmEngine = new GroqProvider(GROQ_API_KEY!)
  const ttsEngine = new ElevenLabsProvider(ELEVENLABS_API_KEY!, ELEVENLABS_VOICE!)

  const assistant = new AssistantService(sttEngine, llmEngine, ttsEngine)

  // 5. Execution
  const result = await assistant.processVoiceRequest(audioFile, businessId, user.id)

  // 6. Transparent Response
  return NextResponse.json(result)
})
