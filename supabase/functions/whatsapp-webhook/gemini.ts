/**
 * Gemini AI Agent for Appointment Scheduling.
 * Implements Multi-turn Tool Calling and Context Injection.
 */

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

// ── Gemini message part types ─────────────────────────────────────────────────

interface TextPart {
  text: string
}

interface FunctionCallPart {
  function_call: {
    name: string
    args: Record<string, string>
  }
}

interface FunctionResponsePart {
  function_response: {
    name:     string
    response: { content: unknown }
  }
}

type MessagePart = TextPart | FunctionCallPart | FunctionResponsePart

export interface GeminiMessage {
  role:  'user' | 'model' | 'function'
  parts: MessagePart[]
}

interface GeminiCandidate {
  content: GeminiMessage
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[]
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface ServiceSummary {
  id:           string
  name:         string
  duration_min: number
  price:        number | null
}

interface ConversationContext {
  businessName: string
  services:     ServiceSummary[]
  currentTime:  string
  customerName: string
}

type ToolExecutor = (name: string, args: Record<string, string>) => Promise<unknown>

// ── Agent ─────────────────────────────────────────────────────────────────────

export async function processConversation(
  prompt:      string,
  context:     ConversationContext,
  executeTool: ToolExecutor
): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const systemInstruction = `
    Eres el asistente inteligente de agendamiento de "${context.businessName}".
    Tu objetivo es ayudar a los clientes a agendar citas de manera amable y eficiente por WhatsApp.

    CONTEXTO ACTUAL:
    - Fecha/Hora actual: ${context.currentTime}
    - Cliente: ${context.customerName}
    - Servicios disponibles: ${JSON.stringify(context.services)}

    REGLAS:
    1. Sé profesional y cálido. Habla siempre en español.
    2. Identificación de servicios: Mapea lo que el cliente pida al 'id' correspondiente de la lista de servicios.
    3. Flujo de agendamiento:
       a) Si el usuario quiere agendar, PRIMERO consulta disponibilidad con 'get_available_slots'.
          IMPORTANTE: Necesitas el 'service_id' para consultar disponibilidad.
       b) Una vez que el usuario confirme un horario, usa 'create_appointment'.
    4. RESPUESTAS: Sé conciso. WhatsApp no es para textos largos.
    5. No inventes horarios ni servicios que no estén en la lista.
  `

  const tools = [
    {
      function_declarations: [
        {
          name:        "get_available_slots",
          description: "Consulta los horarios disponibles para una fecha y servicio específico.",
          parameters: {
            type:       "object",
            properties: {
              date:       { type: "string", description: "Fecha en formato YYYY-MM-DD" },
              service_id: { type: "string", description: "UUID del servicio" }
            },
            required: ["date", "service_id"]
          }
        },
        {
          name:        "create_appointment",
          description: "Crea una nueva reservación/cita en el sistema.",
          parameters: {
            type:       "object",
            properties: {
              client_name: { type: "string" },
              service_id:  { type: "string" },
              date:        { type: "string", description: "YYYY-MM-DD" },
              time:        { type: "string", description: "HH:mm" }
            },
            required: ["client_name", "service_id", "date", "time"]
          }
        }
      ]
    }
  ]

  const messages: GeminiMessage[] = [
    { role: 'user', parts: [{ text: prompt }] }
  ]

  // Multi-turn loop — max 5 turns to prevent infinite loops
  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:           messages,
        system_instruction: { parts: [{ text: systemInstruction }] },
        tools
      })
    })

    if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`)

    const data     = await res.json() as GeminiApiResponse
    const modelMsg = data.candidates?.[0]?.content
    if (!modelMsg) break

    messages.push(modelMsg)

    const toolCalls = modelMsg.parts.filter(
      (p): p is FunctionCallPart => 'function_call' in p
    )

    if (toolCalls.length === 0) {
      return modelMsg.parts
        .filter((p): p is TextPart => 'text' in p)
        .map(p => p.text)
        .join(' ')
    }

    for (const call of toolCalls) {
      const { name, args } = call.function_call
      const result = await executeTool(name, args)
      messages.push({
        role:  'function',
        parts: [{ function_response: { name, response: { content: result } } }]
      })
    }
  }

  return "Lo siento, tuve un problema procesando tu solicitud. ¿Podrías intentar de nuevo?"
}
