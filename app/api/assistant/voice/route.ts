import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api/with-error-handler'
import { safeSTT, safeLLM, safeTTS } from '@/lib/ai/resilience'
import { assistantRateLimiter } from '@/lib/api/rate-limit'
import {
  get_today_summary,
  get_upcoming_gaps,
  get_client_debt,
  cancel_appointment,
  book_appointment,
  register_payment,
} from '@/lib/ai/assistant-tools'

// ── Env ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY       = process.env.LLM_API_KEY || process.env.GROQ_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_VOICE   = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZdr' // "Luis"

// ── Tools Definition ──────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_today_summary',
      description: 'Obtiene un resumen de facturación y citas del día de hoy.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_gaps',
      description: 'Consulta los bloques de tiempo libres en la agenda de hoy.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_debt',
      description: 'Consulta la deuda o citas pendientes de pago de un cliente.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancela la próxima cita pendiente de un cliente.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Agenda una nueva cita para un cliente en un servicio, fecha y hora específicos.',
      parameters: {
        type: 'object',
        properties: {
          client_name:  { type: 'string', description: 'Nombre del cliente' },
          service_name: { type: 'string', description: 'Nombre del servicio (p.ej. Corte de Cabello)' },
          date:         { type: 'string', description: 'Fecha (YYYY-MM-DD, hoy, mañana)' },
          time:         { type: 'string', description: 'Hora (HH:MM)' },
        },
        required: ['client_name', 'service_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_payment',
      description: 'Registra un pago o abono realizado por un cliente.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente' },
          amount:      { type: 'number', description: 'Monto del pago' },
          method:      { type: 'string', description: 'Método (efectivo, tarjeta, transferencia, qr)' },
        },
        required: ['client_name', 'amount', 'method'],
      },
    },
  },
]

const SYSTEM_PROMPT = `Eres "Luis", el Asistente Ejecutivo de IA para Cronix. 
Tu objetivo es ayudar al dueño del negocio con su agenda y finanzas. 
Sé profesional, conciso y utiliza las herramientas disponibles. 
Fecha actual: ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`

// ── Dispatcher ────────────────────────────────────────────────────────────
async function dispatchTool(funcName: string, args: any, bizId: string): Promise<string> {
  console.log(`[AI-TOOL] Executing ${funcName} for biz ${bizId}`, args)
  
  try {
    switch (funcName) {
      case 'get_today_summary': 
        return await get_today_summary(bizId)
      case 'get_upcoming_gaps': 
        return await get_upcoming_gaps(bizId)
      case 'get_client_debt': 
        return await get_client_debt(bizId, args.client_name)
      case 'cancel_appointment': 
        return await cancel_appointment(bizId, args.client_name)
      case 'book_appointment': 
        return await book_appointment(bizId, args.client_name, args.service_name, args.date, args.time)
      case 'register_payment': 
        return await register_payment(bizId, args.client_name, args.amount, args.method)
      default: 
        return `Error: Herramienta "${funcName}" no reconocida.`
    }
  } catch (err: any) {
    return `Error ejecutando herramienta: ${err.message}`
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────
export const POST = withErrorHandler(async (req, _context, supabase, user) => {
  const { data: dbUser } = await supabase.from('users').select('business_id').eq('id', user.id).single()
  const businessId = dbUser?.business_id
  if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

  const formData = await req.formData()
  const audioFile = formData.get('audio') as Blob | null
  if (!audioFile) return NextResponse.json({ error: 'No audio provided' }, { status: 400 })

  // 1. STT: Audio → Texto
  const stt = await safeSTT(audioFile, GROQ_API_KEY!)
  if (!stt.data) throw new Error(`STT failed: ${stt.error}`)
  const userSpokenText = stt.data.text

  // 2. LLM + Function Calling
  const llm = await safeLLM(
    [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userSpokenText }],
    TOOLS,
    GROQ_API_KEY!
  )
  if (!llm.data) throw new Error(`LLM failed: ${llm.error}`)
  
  const responseMessage = llm.data.choices[0].message
  let replyText = responseMessage.content ?? ''

  // 3. Tool execution
  if (responseMessage.tool_calls?.length) {
    const toolCall = responseMessage.tool_calls[0]
    const toolResult = await dispatchTool(toolCall.function.name, JSON.parse(toolCall.function.arguments), businessId)
    
    const secondLlm = await safeLLM(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userSpokenText },
        responseMessage,
        { role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: toolResult },
      ],
      [], // No tools for the second pass
      GROQ_API_KEY!
    )
    if (secondLlm.data) {
      replyText = secondLlm.data.choices[0].message.content ?? toolResult
    }
  }

  // 4. TTS: Texto → Audio
  const tts = await safeTTS(replyText, ELEVENLABS_API_KEY!, ELEVENLABS_VOICE)
  
  return NextResponse.json({ 
    text: replyText, 
    audioUrl: tts.data?.audioUrl,
    useNativeFallback: tts.data?.useNativeFallback 
  })
})
