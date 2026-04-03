import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { DeepgramProvider } from '@/lib/ai/providers/deepgram-provider'
import { AssistantService } from '@/lib/ai/assistant-service'
import { logger } from '@/lib/logger'

/**
 * GET /api/assistant/proactive
 * 
 * Generates a proactive welcome message for the dashboard mount.
 */
export const GET = withErrorHandler(async (req, _context, supabase, user) => {
  // Use the user from the wrapper
  let businessId = user.user_metadata?.business_id

  // Fallback: fetch from database if not in metadata
  if (!businessId) {
    const { data: dbUser } = await supabase.from('users').select('business_id').eq('id', user.id).single()
    businessId = dbUser?.business_id
  }

  if (!businessId) {
    logger.warn('AI-PROACTIVE', 'Business ID not found for user', { userId: user.id })
    return NextResponse.json({ error: 'Business ID not found' }, { status: 400 })
  }

  // 1. Initialize Engines
  const stt = new GroqProvider(process.env.GROQ_API_KEY!)
  const llm = new GroqProvider(process.env.GROQ_API_KEY!)
  
  // PRIMARY TTS: Deepgram Aura 2 — nestor-es (ultra-low latency Spanish male voice)
  const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY
  if (!DEEPGRAM_API_KEY) return NextResponse.json({ error: 'TTS provider not configured' }, { status: 500 })
  const tts = new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-2-nestor-es')
  
  const assistant = new AssistantService(stt, llm, tts)

  // 1. Get Today Context (Raw)
  const { get_today_summary } = await import('@/lib/ai/assistant-tools')
  const summary = await get_today_summary(businessId)

  // 2. Generate a natural greeting via LLM
  const prompt = `Resumen actual: ${summary}. 
  Genera un saludo SUPER CORTO y entusiasta (MÁXIMO 10 PALABRAS) para el dueño del negocio (${user.user_metadata?.name || 'Administrador'}).
  Sé directo y profesional.`

  const greetingRes = await llm.chat([{ role: 'user', content: prompt }])
  const text = greetingRes.message.content || '¡Hola! Qué bueno verte. Ya estoy listo para ayudarte.'

  // 3. Generate Audio
  const ttsRes = await tts.synthesize(text)

  logger.info('AI-PROACTIVE', 'Generated greeting', { userId: user.id })

  return NextResponse.json({
    text,
    audioUrl: ttsRes.audioUrl,
    useNativeFallback: ttsRes.useNativeFallback
  })
})
