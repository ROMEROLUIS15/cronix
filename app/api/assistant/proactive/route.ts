import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import { ElevenLabsProvider } from '@/lib/ai/providers/elevenlabs-provider'
import { AssistantService } from '@/lib/ai/assistant-service'
import { logger } from '@/lib/logger'

/**
 * GET /api/assistant/proactive
 * 
 * Generates a proactive welcome message for the dashboard mount.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const businessId = user.user_metadata?.business_id
  if (!businessId) return NextResponse.json({ error: 'Business not found' }, { status: 400 })

  // Initialize Engines
  const stt = new GroqProvider(process.env.GROQ_API_KEY!)
  const llm = new GroqProvider(process.env.GROQ_API_KEY!)
  const tts = new ElevenLabsProvider(process.env.ELEVENLABS_API_KEY!, 'pNInz6obpg8ndEao7m8D') // Luis Voice
  
  const assistant = new AssistantService(stt, llm, tts)

  // 1. Get Today Context (Raw)
  const { get_today_summary } = await import('@/lib/ai/assistant-tools')
  const summary = await get_today_summary(businessId)

  // 2. Generate a natural greeting via LLM
  const prompt = `Resumen actual: ${summary}. 
  Genera un saludo corto y entusiasta (máx 15 palabras) para el dueño del negocio que acaba de entrar al dashboard.
  Usa el nombre ${user.user_metadata?.name || 'Administrador'}.`

  const greetingRes = await llm.chat([{ role: 'user', content: prompt }])
  const text = greetingRes.message.content || '¡Hola! Qué bueno verte de nuevo. Ya estoy listo para ayudarte hoy.'

  // 3. Generate Audio
  const ttsRes = await tts.synthesize(text)

  logger.info('AI-PROACTIVE', 'Generated greeting', { userId: user.id })

  return NextResponse.json({
    text,
    audioUrl: ttsRes.audioUrl,
    useNativeFallback: ttsRes.useNativeFallback
  })
})
