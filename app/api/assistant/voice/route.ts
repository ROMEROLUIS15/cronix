import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
const ELEVENLABS_VOICE   = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB' // "Adam" — masculino neutro latino

const STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const LLM_URL = 'https://api.groq.com/openai/v1/chat/completions'
const TTS_URL = (voiceId: string) => `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`

// ── Tools schema para el LLM ──────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_today_summary',
      description: 'Obtiene el total facturado hoy y el resumen de citas (completadas, pendientes, canceladas).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_upcoming_gaps',
      description: 'Muestra los bloques horarios ocupados hoy para deducir horas libres.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_debt',
      description: 'Consulta si un cliente tiene citas completadas o deudas pendientes.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre completo o parcial del cliente' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancela la próxima cita activa de un cliente.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente cuya cita se cancela' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Agenda una nueva cita para un cliente. Requiere cliente, servicio, fecha y hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name:  { type: 'string', description: 'Nombre del cliente' },
          service_name: { type: 'string', description: 'Nombre del servicio a realizar' },
          date:         { type: 'string', description: 'Fecha en formato YYYY-MM-DD, o "hoy"/"mañana"' },
          time:         { type: 'string', description: 'Hora en formato HH:MM (24h), ej: "15:00"' },
        },
        required: ['client_name', 'service_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_payment',
      description: 'Registra un cobro, abono o pago para un cliente (sin necesidad de que tenga cita).',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente' },
          amount:      { type: 'number', description: 'Monto del cobro en la moneda local' },
          method:      { type: 'string', description: 'Método de pago: efectivo, tarjeta, transferencia, zelle, qr, otro' },
        },
        required: ['client_name', 'amount', 'method'],
      },
    },
  },
]

// ── System Prompt — Identidad "Luis" ─────────────────────────────────────
const SYSTEM_PROMPT = `Eres Luis, el Asistente Ejecutivo de Inteligencia Artificial de este negocio. 
Tu personalidad: profesional, directo, empático y con un toque de carisma Latino.
Siempre hablas en primera persona: "Encontré...", "Cancelé...", "Registré...".
Respondes MUY brevemente (máximo 2-3 oraciones), pensando en que tu respuesta se escuchará en voz alta.
NUNCA inventas datos. Si no tienes acceso a algo, lo dices con honestidad.
Para acciones de escritura (cancelar, agendar, cobrar), confirma siempre lo que hiciste al final.`

// ── ElevenLabs TTS ────────────────────────────────────────────────────────
async function textToSpeech(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) return null
  try {
    const res = await fetch(TTS_URL(ELEVENLABS_VOICE), {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    })
    if (!res.ok) {
      console.error('[TTS ERROR]', await res.text())
      return null
    }
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return `data:audio/mpeg;base64,${base64}`
  } catch (e) {
    console.error('[TTS EXCEPTION]', e)
    return null
  }
}

// ── Tool dispatcher ───────────────────────────────────────────────────────
async function dispatchTool(
  funcName: string,
  args: Record<string, unknown>,
  businessId: string
): Promise<string> {
  switch (funcName) {
    case 'get_today_summary':
      return get_today_summary(businessId)
    case 'get_upcoming_gaps':
      return get_upcoming_gaps(businessId)
    case 'get_client_debt':
      return get_client_debt(businessId, args.client_name as string)
    case 'cancel_appointment':
      return cancel_appointment(businessId, args.client_name as string)
    case 'book_appointment':
      return book_appointment(
        businessId,
        args.client_name as string,
        args.service_name as string,
        args.date as string,
        args.time as string
      )
    case 'register_payment':
      return register_payment(
        businessId,
        args.client_name as string,
        Number(args.amount),
        args.method as string
      )
    default:
      return 'Herramienta no reconocida.'
  }
}

// ── Route handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: dbUser } = await supabase.from('users').select('business_id').eq('id', user.id).single()
    const businessId = dbUser?.business_id
    if (!businessId) return NextResponse.json({ error: 'No business attached' }, { status: 403 })

    // 1. STT: Audio → Texto ─────────────────────────────────────────────
    const formData = await req.formData()
    const audioFile = formData.get('audio') as Blob | null
    if (!audioFile) return NextResponse.json({ error: 'No audio provided' }, { status: 400 })

    const sttForm = new FormData()
    sttForm.append('file', audioFile, 'voice.webm')
    sttForm.append('model', 'whisper-large-v3')
    sttForm.append('language', 'es')

    const sttRes = await fetch(STT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: sttForm,
    })
    if (!sttRes.ok) {
      const err = await sttRes.text()
      console.error('[STT ERROR]', err)
      throw new Error(`STT falló: ${err}`)
    }
    const { text: userSpokenText } = await sttRes.json()
    console.log('[Luis] Oyó:', userSpokenText)

    // 2. LLM + Function Calling ─────────────────────────────────────────
    const llmPayload = {
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userSpokenText },
      ],
      tools: TOOLS,
      tool_choice: 'auto',
    }

    const llmRes  = await fetch(LLM_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(llmPayload),
    })
    const llmData = await llmRes.json()
    const responseMessage = llmData.choices[0].message
    let replyText: string = responseMessage.content ?? ''

    // 3. Tool execution ─────────────────────────────────────────────────
    if (responseMessage.tool_calls?.length) {
      const toolCall = responseMessage.tool_calls[0]
      const funcName = toolCall.function.name
      const args     = JSON.parse(toolCall.function.arguments || '{}')

      console.log('[Luis] Usa herramienta:', funcName, args)

      let toolResult: string
      try {
        toolResult = await dispatchTool(funcName, args, businessId)
      } catch (e: unknown) {
        toolResult = `Error interno al ejecutar la herramienta: ${(e as Error).message}`
      }

      // Segunda llamada al LLM con el resultado de la Tool
      const secondRes = await fetch(LLM_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: userSpokenText },
            responseMessage,
            { role: 'tool', tool_call_id: toolCall.id, name: funcName, content: toolResult },
          ],
        }),
      })
      const secondData = await secondRes.json()
      replyText = secondData.choices[0].message.content ?? toolResult
    }

    console.log('[Luis] Responde:', replyText)

    // 4. TTS: Texto → Audio (ElevenLabs o fallback navegador) ───────────
    const audioUrl = await textToSpeech(replyText)

    return NextResponse.json({ text: replyText, audioUrl })

  } catch (error: unknown) {
    console.error('[Luis] Error en API de voz:', error)
    return NextResponse.json(
      { error: (error as Error)?.message || 'Falla del servidor' },
      { status: 500 }
    )
  }
}
