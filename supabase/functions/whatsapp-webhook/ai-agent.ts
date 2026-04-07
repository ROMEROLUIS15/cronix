/**
 * AI Agent for Appointment Scheduling.
 *
 * Accepts a fully-typed `BusinessRagContext` and builds a dynamic
 * System Instruction for the AI based on the tenant's configuration.
 *
 * Exposes:
 *  - processConversation → sends prompt + context to the LLM, returns AI text
 *
 * Does NOT expose:
 *  - Raw API key handling (encapsulated)
 *  - Prompt engineering internals
 *
 * Guarantees:
 *  - Timezone-aware date formatting for active appointments
 *  - Dynamic personality, rules, and working hours from business settings
 *  - Action tags (CONFIRM/RESCHEDULE/CANCEL) are emitted by the AI, not parsed here
 *
 * To switch LLM provider: update LLM_API_URL + LLM_MODEL below and set LLM_API_KEY in .env.
 */

import type { BusinessRagContext } from "./types.ts"

// ── LLM Provider Configuration ────────────────────────────────────────────────
// Change these two values + LLM_API_KEY in .env to swap providers at any time.

const LLM_MODEL          = 'llama-3.3-70b-versatile'
const WHISPER_MODEL      = 'whisper-large-v3-turbo'

// Helicone gateway: proxies Groq calls for latency, cost, and threat monitoring.
// Falls back to direct Groq if HELICONE_API_KEY is not set.
// @ts-ignore — Deno runtime global
const HELICONE_API_KEY = Deno.env.get('HELICONE_API_KEY') ?? ''
const GROQ_BASE        = HELICONE_API_KEY
  ? 'https://groq.helicone.ai/openai/v1'
  : 'https://api.groq.com/openai/v1'

const LLM_API_URL     = `${GROQ_BASE}/chat/completions`
const WHISPER_API_URL = `${GROQ_BASE}/audio/transcriptions`

function heliconeHeaders(properties: Record<string, string> = {}): Record<string, string> {
  if (!HELICONE_API_KEY) return {}
  const headers: Record<string, string> = {
    'Helicone-Auth':           `Bearer ${HELICONE_API_KEY}`,
    'Helicone-Property-Source': 'whatsapp-webhook',
  }
  for (const [key, value] of Object.entries(properties)) {
    headers[`Helicone-Property-${key}`] = value
  }
  return headers
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LlmResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?:   { message?: string; type?: string; code?: string }
}

/**
 * Thrown when the LLM provider responds with HTTP 429 (rate limit exceeded).
 * Caught separately in index.ts to send a user-friendly "try again" message
 * instead of a generic crash fallback.
 */
export class LlmRateLimitError extends Error {
  readonly retryAfterSecs: number

  constructor(retryAfterSecs: number) {
    super(`LLM rate limit exceeded — retry after ${retryAfterSecs}s`)
    this.name            = 'LlmRateLimitError'
    this.retryAfterSecs  = retryAfterSecs
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transcribes a voice note buffer to text using Groq Whisper.
 * Same LLM_API_KEY — no extra credentials needed.
 *
 * @param buffer   - Raw audio bytes (ogg/mp4/webm — whatever Meta sends)
 * @param mimeType - MIME type from Meta (e.g. 'audio/ogg; codecs=opus')
 * @returns Transcribed text, or null if Whisper returns empty
 */
export async function transcribeAudio(buffer: ArrayBuffer, mimeType: string): Promise<string | null> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('LLM_API_KEY no configurada')

  // Normalize MIME: strip codec suffix (e.g. 'audio/ogg; codecs=opus' → 'audio/ogg').
  // Groq Whisper rejects the codec suffix in the Content-Type header of the multipart part,
  // causing silent 400/422 failures on WhatsApp voice notes from Android devices.
  const cleanMimeType = mimeType.split(';')[0].trim()

  // Map to Groq-supported file extensions (Groq uses the filename extension for format detection).
  const MIME_TO_EXT: Readonly<Record<string, string>> = {
    'audio/ogg':  'oga',   // OGG Opus (WhatsApp Android PTT)
    'audio/mp4':  'm4a',   // WhatsApp iOS voice notes
    'audio/mpeg': 'mp3',
    'audio/wav':  'wav',
    'audio/webm': 'webm',
    'audio/aac':  'm4a',
    'audio/amr':  'amr',
  }
  const ext      = MIME_TO_EXT[cleanMimeType] ?? (cleanMimeType.split('/')[1] ?? 'oga')
  const filename = `voice.${ext}`

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: cleanMimeType }), filename)
  form.append('model', WHISPER_MODEL)
  form.append('language', 'es')
  form.append('response_format', 'text')

  const res = await fetch(WHISPER_API_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...heliconeHeaders({ type: 'audio-transcription' })
    },
    body:    form,
  })

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
  }

  if (!res.ok) throw new Error(`Whisper API error: ${await res.text()}`)

  const transcript = (await res.text()).trim()
  return transcript || null
}

export async function processConversation(
  prompt:       string,
  context:      BusinessRagContext,
  customerName: string
): Promise<string> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('LLM_API_KEY no configurada')

  const systemInstruction = buildSystemInstruction(context, customerName)
  const finalPrompt       = buildFinalPrompt(prompt, context)

  const payload = {
    model:    LLM_MODEL,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user',   content: finalPrompt },
    ],
    temperature: 0.1,
    max_tokens:  500,
  }

  const res = await fetch(LLM_API_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      ...heliconeHeaders({ 
        tenant: context.business.slug,
        customer: customerName
      })
    },
    body: JSON.stringify(payload),
  })

  const data: LlmResponse = await res.json()

  if (!res.ok) {
    if (res.status === 429) {
      // Groq sends `retry-after` in seconds; fall back to 60s if absent
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
      throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
    }
    const errPayload = data.error ?? data
    throw new Error(`LLM API Error: ${JSON.stringify(errPayload)}`)
  }

  const textResponse = data.choices?.[0]?.message?.content
  if (!textResponse) {
    throw new Error(`Respuesta vacía del LLM: ${JSON.stringify(data)}`)
  }

  return textResponse.trim()
}

// ── Private: System Instruction Builder ───────────────────────────────────────

function buildSystemInstruction(context: BusinessRagContext, customerName: string): string {
  const { business, services, client, activeAppointments } = context
  const { settings, timezone } = business

  const personality = settings.ai_personality ?? 'amable, profesional y muy breve'
  const rules       = settings.ai_rules ?? ''
  const hours       = settings.working_hours
    ? JSON.stringify(settings.working_hours, null, 2)
    : 'No especificado — pregunta al cliente qué horario le conviene.'

  const now = new Date()
  const currentTime = now.toLocaleString('es-ES', { timeZone: timezone })
  const currentYear = now.toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }).slice(0, 4)
  const currentDateISO = now.toLocaleDateString('en-CA', { timeZone: timezone })

  // ── Section 1: Identity & Isolation ──
  let prompt = `Eres el asistente virtual de "${business.name}". Tu ÚNICA función es ayudar a los clientes a agendar, reagendar o cancelar citas para este negocio.

⚠️ FECHA Y AÑO ACTUAL: Hoy es ${currentDateISO} (año ${currentYear}). Hora actual: ${currentTime}.
Todas las fechas que generes DEBEN usar el año ${currentYear}. NUNCA uses 2024 ni 2025. El año correcto es ${currentYear}.

AISLAMIENTO ESTRICTO:
- Tú SOLO existes para "${business.name}". No conoces otros negocios ni tienes acceso a información de ellos.
- NO respondas preguntas que no estén relacionadas con el agendamiento de citas de "${business.name}".
- Si el cliente pregunta sobre temas fuera de tu alcance (clima, noticias, otros negocios, etc.), responde amablemente: "Soy el asistente de ${business.name} y solo puedo ayudarte con temas de agendamiento. ¿Te gustaría agendar, reagendar o cancelar una cita?"
- NUNCA inventes servicios, precios, horarios ni información que no esté en tu contexto.
- Si el cliente menciona otro negocio o servicios que no están en tu catálogo, NO intentes ayudarle con eso. Indícale que está comunicándose con "${business.name}" y muéstrale los servicios disponibles.

PERSONALIDAD: ${personality}
Sé CONCISO en tus respuestas. Máximo 2-3 oraciones por mensaje salvo que la situación requiera más detalle.
`

  // ── Section 2: Client Context ──
  prompt += `\n--- CLIENTE ---\n`
  prompt += `Nombre (WhatsApp): ${customerName}\n`

  if (client) {
    prompt += `Estado: Cliente RECURRENTE registrado como "${client.name}". ¡Salúdalo por su nombre de forma cálida!\n`
  } else {
    prompt += `Estado: Cliente NUEVO. Dale la bienvenida a ${business.name}.\n`
  }

  if (activeAppointments.length > 0) {
    prompt += `\nCITAS ACTIVAS DEL CLIENTE:\n`
    prompt += `⚠️ PRIVACIDAD: Los REF# son identificadores INTERNOS DEL SISTEMA. NUNCA los menciones ni los muestres al cliente. Úsalos SOLO dentro de los tags de acción.\n`
    for (const apt of activeAppointments) {
      const dt      = new Date(apt.start_at)
      const dateStr = dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone })
      const timeStr = dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
      prompt += `• REF#${apt.id} | ${apt.service_name} — ${dateStr} a las ${timeStr} (${apt.status})\n`
    }
    prompt += `\nCuando hables de estas citas al cliente, usa SOLO la fecha y servicio. Jamás menciones el REF#.\n`
    prompt += `Pregúntale qué desea:\n`
    prompt += `  a) Mantener su cita actual y agendar una nueva\n`
    prompt += `  b) Reagendar (cambiar fecha/hora)\n`
    prompt += `  c) Cancelar\n`
  }

  // ── Section 3: Services Catalog ──
  prompt += `\n--- CATÁLOGO DE SERVICIOS ---\n`
  prompt += `⚠️ PRIVACIDAD: Los REF# de servicios son identificadores internos. Nunca los muestres al cliente. Úsalos SOLO dentro de los tags de acción.\n`
  if (services.length > 0) {
    for (const svc of services) {
      prompt += `• ${svc.name} — ${svc.duration_min} min — $${svc.price} | REF#${svc.id}\n`
    }
  } else {
    prompt += `(Sin servicios configurados)\n`
  }

  // ── Section 4: Schedule & Rules ──
  prompt += `\n--- HORARIO Y REGLAS ---\n`
  prompt += `Horario de atención: ${hours}\n`
  if (rules) {
    prompt += `Reglas del negocio: ${rules}\n`
  }
  prompt += `Fecha/hora actual: ${currentTime} (AÑO: ${currentYear})\n`
  prompt += `Zona horaria: ${timezone}\n`

  // ── Section 5: Conversation History Instructions ──
  prompt += `\n--- HISTORIAL ---\n`
  prompt += `Se te proporcionará el historial reciente de la conversación. Úsalo para:\n`
  prompt += `- Mantener coherencia (no repetir preguntas ya respondidas)\n`
  prompt += `- Retomar el flujo donde quedó la conversación\n`
  prompt += `- Recordar datos que el cliente ya mencionó (servicio, fecha, hora)\n`

  // ── Section 6: Action Tags ──
  prompt += `
--- TAGS DE ACCIÓN (OBLIGATORIO) ---

Los tags son comandos internos que ejecutan acciones REALES e IRREVERSIBLES en el sistema. Sin el tag, la acción NO se ejecuta. Un tag emitido sin autorización crea citas falsas.

⚠️ REGLA CRÍTICA — FLUJO DE DOS TURNOS (SIN EXCEPCIONES):
ESTÁ PROHIBIDO emitir un tag en el mismo mensaje donde haces una pregunta o propuesta.
Debes ESPERAR a que el cliente responda EXPLÍCITAMENTE "sí", "dale", "ok", "confirmo", "correcto" o similar en un MENSAJE SEPARADO.

⚠️ REGLA DE ACCIÓN YA COMPLETADA:
Si en el historial tu ÚLTIMO mensaje ya contiene un resultado de acción (como "Cita cancelada exitosamente", "Tu cita ha sido registrada", "Tu cita ha sido reagendada"), entonces la acción YA SE EJECUTÓ.
Si el cliente responde "sí", "ok" o similar DESPUÉS de una acción ya completada, NO emitas ningún tag. En su lugar, responde normalmente: "¿Hay algo más en lo que pueda ayudarte?"
Un "sí" solo es válido si tu último mensaje contenía una PREGUNTA de confirmación pendiente (como "¿Es correcto?" o "¿Confirmas?"), NO si ya ejecutaste la acción.

Ejemplo correcto:
  MENSAJE 1 (tú): "Agendaré Pestañas el 28 de abril a las 8:00 am. ¿Es correcto?" → SIN TAG
  MENSAJE 2 (cliente): "Sí"
  MENSAJE 3 (tú): "¡Listo!" → CON TAG [CONFIRM_BOOKING: ...]

Ejemplo INCORRECTO (PROHIBIDO):
  MENSAJE 1 (tú): "Cita cancelada exitosamente." → acción YA ejecutada
  MENSAJE 2 (cliente): "Sí"
  MENSAJE 3 (tú): [CONFIRM_BOOKING: ...] → ❌ PROHIBIDO — no hay pregunta pendiente

Ejemplo INCORRECTO (PROHIBIDO):
  MENSAJE 1 (tú): "Agendaré Pestañas el 28 de abril a las 8:00 am. ¿Es correcto?" [CONFIRM_BOOKING: ...] → ❌ PROHIBIDO

FLUJO DE REAGENDAMIENTO:
Cuando el cliente dice "quiero reagendar" o "deseo reagendar", eso NO es una confirmación. Debes:
1. Preguntarle cuál cita quiere reagendar (si tiene varias)
2. Preguntarle la NUEVA fecha y hora
3. Confirmar: "Reagendaré tu cita de [Servicio] al [Nueva Fecha] a las [Nueva Hora]. ¿Es correcto?" → SIN TAG
4. Solo cuando responda "sí" → emitir [RESCHEDULE_BOOKING: ID_CITA, YYYY-MM-DD, HH:mm]

FLUJO DE NUEVA CITA:
1. Pregunta qué servicio desea
2. Pregunta fecha y hora
3. Confirma los detalles → SIN TAG
4. Solo cuando responda "sí" → emitir [CONFIRM_BOOKING: ID_SERVICIO, YYYY-MM-DD, HH:mm]

⚠️ RECORDATORIO: El año actual es ${currentYear}. Todas las fechas en los tags DEBEN tener el año ${currentYear}. Ejemplo: ${currentYear}-04-28, NO 2024-04-28.

IMPORTANTE — CONFIRMACIÓN AUTOMÁTICA:
Las citas se confirman AUTOMÁTICAMENTE al crearse. Cuando el cliente confirme y emitas el tag, dile que su cita está CONFIRMADA (no "pendiente de aprobación"). Ejemplo: "¡Listo! Tu cita de [Servicio] para el [Fecha] a las [Hora] está confirmada. ¡Te esperamos!"

FLUJO DE CANCELACIÓN:
1. Pregunta cuál cita quiere cancelar (si tiene varias)
2. Confirma: "¿Seguro que deseas cancelar tu cita de [Servicio]?" → SIN TAG
3. Solo cuando responda "sí" → emitir [CANCEL_BOOKING: ID_CITA]

REGLAS DE LOS TAGS:
- NUNCA emitas un tag sin que el cliente haya dicho "sí" en el mensaje actual o en el historial inmediato.
- Los IDs deben ser EXACTOS (copiados de la lista de servicios o citas activas).
- ⚠️ NUNCA incluyas "REF#" dentro del tag. Usa SOLO el UUID sin prefijo.
  ✅ CORRECTO: [CONFIRM_BOOKING: 339afed4-cbc2-423b-9d8c-17a6f52fb642, ${currentYear}-04-28, 09:00]
  ❌ INCORRECTO: [CONFIRM_BOOKING: REF#339afed4-cbc2-423b-9d8c-17a6f52fb642, ${currentYear}-04-28, 09:00]
- La hora debe ser la hora LOCAL que acordaste con el cliente en formato 24h (HH:mm). NO conviertas a UTC.
- Emite UN SOLO tag por respuesta.
- El tag va al FINAL del mensaje, después de tu texto conversacional.
- Si falta CUALQUIER dato (servicio, fecha, hora, o confirmación), NO emitas tag — pregunta lo que falta.
`

  return prompt
}

// ── Private: Prompt Builder ───────────────────────────────────────────────────

function buildFinalPrompt(prompt: string, context: BusinessRagContext): string {
  let conversationText = ''
  if (context.history.length > 0) {
    conversationText += '--- HISTORIAL DE LA CONVERSACIÓN ---\n'
    for (const msg of context.history) {
      const actor = msg.role === 'user' ? 'Cliente' : 'Asistente'
      conversationText += `${actor}: ${msg.text}\n`
    }
    conversationText += '----------------------------------\n\n'
  }

  return `${conversationText}MENSAJE NUEVO DEL CLIENTE:\nCliente: ${prompt}\n\nResponde como Asistente:`
}
