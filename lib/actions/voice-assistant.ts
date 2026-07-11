'use server'

/**
 * AI Server Actions for Cronix Dashboard.
 *
 * LLM calls go through GroqProvider.chat() — the single canonical entry point
 * for all LLM interactions in this system. This inherits:
 *  - safeLLM wrapper (retry + exponential back-off)
 *  - aiCircuit circuit breaker (opens after repeated failures)
 *  - Cerebras 70B → Groq 8B automatic fallback (quality tier)
 *  - GROQ_API_KEY env var (shared across all AI modules)
 *
 * To switch LLM provider: update GroqProvider or add a new ILlmProvider
 * implementation — this file needs no changes.
 */

import { logger }       from '@/lib/logger'
import { GroqProvider } from '@/lib/ai/providers/groq-provider'
import type { Service, Client } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParseResult {
  client_id?:        string
  service_id?:       string
  date?:             string
  time?:             string
  notes?:            string
  assigned_user_id?: string
}

type VoiceCommandContext = {
  services: Pick<Service, 'id' | 'name'>[]
  clients:  Pick<Client,  'id' | 'name'>[]
}

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * Parses a natural language voice command into structured appointment data.
 *
 * Uses the 'quality' tier: Cerebras llama-3.3-70b primary (optimal for JSON
 * entity extraction) → Groq openai/gpt-oss-20b fallback.
 * Both paths go through safeLLM (retry) and aiCircuit (circuit breaker).
 */
export async function parseVoiceCommand(
  transcript: string,
  context:    VoiceCommandContext
): Promise<ParseResult | null> {
  // LLM_API_KEY is the primary key in .env.local (supports comma-separated rotation).
  // GROQ_API_KEY is the alias used in some Next.js routes — accept both for robustness.
  // GroqProvider.chat() passes the first key to safeLLM; rotation happens inside resilience.ts.
  const apiKey = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY
  if (!apiKey) {
    logger.error('voice-assistant', 'LLM_API_KEY (or GROQ_API_KEY) not found in environment')
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
    const provider = new GroqProvider(apiKey)
    const result   = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: transcript   },
      ],
      [],        // no tools
      'quality', // Cerebras 70B → Groq 8B fallback; inherits aiCircuit + safeLLM
    )

    if (result.error || !result.message?.content) return null

    // Strip markdown code fences if the model wraps the JSON
    const clean = result.message.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    return JSON.parse(clean) as ParseResult
  } catch (error) {
    logger.error('voice-assistant', 'Error parsing voice command', error)
    return null
  }
}
