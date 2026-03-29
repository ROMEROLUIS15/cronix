'use server'

/**
 * AI Server Actions for Cronix Dashboard.
 *
 * To switch LLM provider: update LLM_API_URL + LLM_MODEL below and set LLM_API_KEY in .env.
 */

import { logger } from '@/lib/logger'
import type { Service, Client } from '@/types'

// ── LLM Provider Configuration ────────────────────────────────────────────────
// Change these two values + LLM_API_KEY in .env to swap providers at any time.

const LLM_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const LLM_MODEL   = 'llama-3.3-70b-versatile'

interface ParseResult {
  client_id?: string
  service_id?: string
  date?: string
  time?: string
  notes?: string
  assigned_user_id?: string
}

interface LlmApiResponse {
  choices?: Array<{
    message?: { content?: string }
  }>
}

type VoiceCommandContext = {
  services: Pick<Service, 'id' | 'name'>[]
  clients:  Pick<Client,  'id' | 'name'>[]
}

/**
 * Parses a natural language voice command into structured appointment data.
 */
export async function parseVoiceCommand(
  transcript: string,
  context: VoiceCommandContext
): Promise<ParseResult | null> {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    logger.error('voice-assistant', 'LLM_API_KEY not found in environment')
    return null
  }

  const systemPrompt = `
    Eres un asistente de oficina experto. Tu tarea es extraer información de citas de un texto de voz.

    SERVICIOS DISPONIBLES:
    ${JSON.stringify(context.services.map(s => ({ id: s.id, name: s.name })))}

    CLIENTES EXISTENTES:
    ${JSON.stringify(context.clients.map(c => ({ id: c.id, name: c.name })))}

    REGLAS:
    1. Identifica el nombre del cliente y busca su 'id' en la lista. Si no existe, no devuelvas id.
    2. Identifica el servicio y busca el 'id' exacto.
    3. Extrae la fecha en formato YYYY-MM-DD y la hora en HH:mm.
    4. Si el texto menciona notas, extráelas.
    5. RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO, sin explicaciones ni markdown.
    6. Hoy es ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

    FORMATO DE RESPUESTA:
    {
      "client_id": "uuid",
      "service_id": "uuid",
      "date": "YYYY-MM-DD",
      "time": "HH:mm",
      "notes": "texto"
    }
  `

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: transcript },
        ],
        temperature: 0.1,
        max_tokens:  256,
      }),
    })

    if (!response.ok) throw new Error(`LLM API error: ${await response.text()}`)

    const data = await response.json() as LlmApiResponse
    const text = data.choices?.[0]?.message?.content

    if (!text) return null

    // Strip markdown code fences if the model wraps the JSON
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(clean) as ParseResult
  } catch (error) {
    logger.error('voice-assistant', 'Error parsing voice command', error)
    return null
  }
}
