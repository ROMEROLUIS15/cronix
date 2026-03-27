'use server'

/**
 * AI Server Actions for Cronix Dashboard.
 * Powered by Google Gemini 1.5 Flash.
 */

import { logger } from '@/lib/logger'
import type { Service, Client } from '@/types'

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

interface ParseResult {
  client_id?: string
  service_id?: string
  date?: string
  time?: string
  notes?: string
  assigned_user_id?: string
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
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
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    logger.error('voice-assistant', 'GEMINI_API_KEY not found in environment')
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
    5. RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO.
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
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: transcript }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    })

    if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)

    const data = await response.json() as GeminiApiResponse
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) return null
    return JSON.parse(text) as ParseResult
  } catch (error) {
    logger.error('voice-assistant', 'Error parsing voice command', error)
    return null
  }
}
