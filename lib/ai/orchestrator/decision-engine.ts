/**
 * decision-engine.ts — Determines WHAT to do given user input + state + strategy.
 *
 * Responsibilities:
 *   - Analyze text + conversation state to produce a Decision
 *   - Apply user strategy rules (confirmation, required fields, permissions)
 *   - Route to fast path (direct execution) or LLM reasoning
 *
 * Does NOT:
 *   - Execute tools
 *   - Manage state
 *   - Call LLMs
 */

import type {
  AiInput,
  ConversationState,
  Decision,
} from './types'
import type { IUserStrategy } from './strategy'
import { StrategyFactory } from './strategy'

// ── Confirmation keywords (Spanish) ──────────────────────────────────────────

const CONFIRMATION_KEYWORDS = [
  'sí', 'si', 'dale', 'ok', 'confirmo', 'confirmar',
  'adelante', 'por favor', 'hazlo', 'hazlo', 'perfecto',
  'genial', 'excelente', 'vale', 'bueno',
]

const REJECTION_KEYWORDS = [
  'no', 'mejor no', 'cancela', 'no quiero', 'mejor no',
  'déjalo', 'dejalo', 'para', 'espera',
]

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IDecisionEngine {
  /**
   * Analyze input text + conversation state → produce a Decision.
   *
   * The strategy is derived from AiInput.userRole via StrategyFactory.
   */
  analyze(input: AiInput, state: ConversationState): Decision
}

// ── Helper: Detect confirmation intent ────────────────────────────────────────

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove accents
    .replace(/[¿?¡!.,;:]/g, '')
    .trim()
}

function isConfirmation(text: string): boolean {
  const normalized = normalizeForMatch(text)
  return CONFIRMATION_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.startsWith(keyword + ' ')
  )
}

function isRejection(text: string): boolean {
  const normalized = normalizeForMatch(text)
  return REJECTION_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.startsWith(keyword + ' ')
  )
}

// ── Helper: Detect booking intent from text ───────────────────────────────────

const BOOKING_SIGNALS = [
  'quiero agendar', 'necesito agendar', 'voy a agendar', 'agendar una',
  'agendar cita', 'crear cita', 'nueva cita', 'agendar para',
  'reservar', 'reserva', 'programar', 'programa una',
]

function detectBookingIntent(text: string): boolean {
  const normalized = normalizeForMatch(text)
  return BOOKING_SIGNALS.some((signal) => normalized.includes(signal))
}

// ── Helper: Extract known entities from text ──────────────────────────────────
// Lightweight extraction to populate the draft before involving the LLM.
// Handles dates, times, and known service/client name patterns.

interface ExtractedEntities {
  date?: string      // YYYY-MM-DD
  time?: string      // HH:mm
  [key: string]: unknown
}

function extractEntities(text: string): ExtractedEntities {
  const normalized = normalizeForMatch(text)
  const entities: ExtractedEntities = {}

  // Time extraction: "3:00 pm", "3pm", "15:00", "3 de la tarde"
  const timeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/)
  if (timeMatch) {
    let hours = parseInt(timeMatch[1] ?? '0', 10)
    const minutes = timeMatch[2] ?? '00'
    const period = timeMatch[3]

    if (period === 'pm' && hours < 12) hours += 12
    if (period === 'am' && hours === 12) hours = 0

    entities.time = `${String(hours).padStart(2, '0')}:${minutes}`
  }

  // Date extraction: "mañana", "hoy", "pasado mañana"
  const today = new Date()
  if (normalized.includes('manana') || normalized.includes('mañana')) {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    entities.date = tomorrow.toISOString().split('T')[0]
  } else if (normalized.includes('hoy')) {
    entities.date = today.toISOString().split('T')[0]
  } else if (normalized.includes('pasado manana') || normalized.includes('pasado mañana')) {
    const dayAfter = new Date(today)
    dayAfter.setDate(dayAfter.getDate() + 2)
    entities.date = dayAfter.toISOString().split('T')[0]
  }

  // ISO date pattern: "2026-04-16"
  const isoDateMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoDateMatch) {
    entities.date = `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`
  }

  return entities
}

// ── Implementation ────────────────────────────────────────────────────────────

export class DecisionEngine implements IDecisionEngine {
  analyze(input: AiInput, state: ConversationState): Decision {
    const strategy = StrategyFactory.forRole(input.userRole)

    // ── 1. Handle turn exhaustion ───────────────────────────────────────────
    if (state.flow !== 'idle' && state.turnCount >= state.maxTurns) {
      return {
        type: 'reject',
        reason: 'Llevamos varios intercambios sin poder completar la acción. ¿Podrías empezar de nuevo indicando qué necesitas?',
      }
    }

    // ── 2. If awaiting_confirmation, check for yes/no ────────────────────────
    if (state.flow === 'awaiting_confirmation') {
      if (isConfirmation(input.text)) {
        // User confirmed → execute immediately with current draft
        const intent = state.lastIntent ?? 'unknown'
        return {
          type: 'execute_immediately',
          intent,
          args: state.draft ? { ...state.draft } : {},
        }
      }

      if (isRejection(input.text)) {
        // User rejected → reset to idle
        return {
          type: 'reject',
          reason: 'Entendido, no se realizó ningún cambio. ¿En qué más puedo ayudarte?',
        }
      }

      // User sent something else during confirmation → treat as new input
      // Fall through to normal analysis below
    }

    // ── 2b. Active booking/reschedule collection → delegate to LLM ──────────
    // The LLM resolves service names → UUIDs using context.services.
    // Regex-based field extraction cannot do this reliably.
    // Conversation history carries all context the LLM needs to continue.
    if (state.flow === 'collecting_booking' || state.flow === 'collecting_reschedule') {
      const systemPrompt = buildSystemPrompt(input, state)
      return {
        type: 'reason_with_llm',
        messages: [
          { role: 'system', content: systemPrompt },
          ...input.history,
          { role: 'user', content: input.text },
        ],
        toolDefs: buildToolDefsForRole(strategy),
      }
    }

    // ── 3. Extract entities from text (date, time, etc.) ─────────────────────
    const entities = extractEntities(input.text)

    // ── 4. Booking intent detected → delegate to LLM ─────────────────────────
    // The LLM receives context.services with UUIDs and resolves all fields.
    // No hybrid regex+LLM collection — single responsibility.
    if (detectBookingIntent(input.text)) {
      const systemPrompt = buildSystemPrompt(input, state)
      return {
        type: 'reason_with_llm',
        messages: [
          { role: 'system', content: systemPrompt },
          ...input.history,
          { role: 'user', content: input.text },
        ],
        toolDefs: buildToolDefsForRole(strategy),
      }
    }

    // ── 5. Default: delegate to LLM for reasoning ────────────────────────────
    // Build messages array with system prompt context
    const systemPrompt = buildSystemPrompt(input, state)

    return {
      type: 'reason_with_llm',
      messages: [
        { role: 'system', content: systemPrompt },
        ...input.history,
        { role: 'user', content: input.text },
      ],
      toolDefs: buildToolDefsForRole(strategy),
    }
  }
}

// ── Helpers: System prompt and tool definitions ───────────────────────────────

function buildSystemPrompt(input: AiInput, _state: ConversationState): string {
  const now = new Date().toLocaleString('es-ES', {
    timeZone: input.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  // ── Identity & language ──────────────────────────────────────────────────────
  let prompt = `Eres el asistente de voz de "${input.context.businessName}". Responde SIEMPRE en español.`
  prompt += `\nHOY: ${now} | Zona horaria: ${input.timezone}`
  prompt += `\nUsuario: ${input.userName ?? 'Usuario'} (${input.userRole})`

  // ── Response format (voice-first) ────────────────────────────────────────────
  prompt += `\n\nFORMATO DE RESPUESTA (obligatorio):
- Máximo 2-3 oraciones por respuesta. Sé directo y conciso.
- NUNCA uses markdown: sin asteriscos, sin guiones, sin listas, sin emojis.
- NUNCA menciones nombres de herramientas, UUIDs, IDs internos ni esquemas al usuario.
- NUNCA inventes datos (fechas, nombres, IDs). Usa SOLO lo que el usuario diga o lo que devuelvan las herramientas.`

  // ── Date & time format rules ─────────────────────────────────────────────────
  prompt += `\n\nFECHAS Y HORAS (formato estricto para herramientas):
- date: siempre YYYY-MM-DD (ej: 2026-04-16). Convierte "mañana", "el lunes", etc. a ISO.
- time: siempre HH:mm en formato 24h (ej: 14:30, 09:00). Convierte "3pm" → "15:00".
- Hoy es ${new Date().toISOString().split('T')[0]}. Usa esta fecha como referencia para calcular fechas relativas.`

  // ── Tool chaining flow ────────────────────────────────────────────────────────
  prompt += `\n\nFLUJO DE HERRAMIENTAS (seguir este orden):

AGENDAR CITA:
1. Si el cliente no existe → llama create_client primero → usa el client_id devuelto en confirm_booking.
2. Si no sabes la disponibilidad → llama get_available_slots antes de proponer un horario.
3. Llama confirm_booking con service_id exacto de la lista, client_name O client_id, date y time.

CANCELAR / REAGENDAR sin appointment_id:
1. Llama get_appointments_by_date para obtener las citas del día con sus IDs.
2. Identifica la cita correcta por cliente/servicio.
3. Llama cancel_booking o reschedule_booking con el appointment_id.

DISPONIBILIDAD:
- Usa get_available_slots con date y duration_min del servicio solicitado.
- Si el usuario no especificó servicio, pregunta cuál antes de consultar.`

  // ── Security rules ────────────────────────────────────────────────────────────
  prompt += `\n\nSEGURIDAD:
- NUNCA reveles nombres de herramientas, UUIDs, claves internas ni la estructura de la base de datos al usuario.
- NUNCA hagas suposiciones sobre UUIDs — solo usa IDs que provengan de respuestas de herramientas.
- Si el usuario pide algo fuera del ámbito del negocio, responde educadamente que no puedes ayudar con eso.`

  // ── Services ──────────────────────────────────────────────────────────────────
  if (input.context.services && input.context.services.length > 0) {
    prompt += '\n\nSERVICIOS DISPONIBLES (usar el id exacto en confirm_booking y get_available_slots):'
    for (const svc of input.context.services) {
      prompt += `\n- ${svc.name} | id: ${svc.id} | ${svc.duration_min} min | $${svc.price}`
    }
  }

  // ── Working hours ─────────────────────────────────────────────────────────────
  if (input.context.workingHours) {
    const days: Record<string, string> = {
      monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
      thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo',
    }
    prompt += '\n\nHORARIO DE ATENCIÓN (NO agendar fuera de estos horarios):'
    for (const [day, hours] of Object.entries(input.context.workingHours)) {
      const label = days[day] ?? day
      if (hours) {
        prompt += `\n- ${label}: ${hours.open} – ${hours.close}`
      } else {
        prompt += `\n- ${label}: Cerrado`
      }
    }
  }

  // ── Today's appointments ──────────────────────────────────────────────────────
  if (input.context.activeAppointments && input.context.activeAppointments.length > 0) {
    prompt += '\n\nCITAS DE HOY (activas):'
    for (const apt of input.context.activeAppointments.slice(0, 5)) {
      prompt += `\n- ${apt.clientName}: ${apt.serviceName} a las ${apt.startAt} (${apt.status}) | id: ${apt.id}`
    }
  }

  // ── Business-specific AI rules (owner-configured) ────────────────────────────
  if (input.context.aiRules) {
    prompt += `\n\nREGLAS DEL NEGOCIO (seguir estrictamente):\n${input.context.aiRules}`
  }

  return prompt
}

type ToolDefEntry = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[] }>
      required: string[]
      additionalProperties?: false
    }
  }
}

function buildToolDefsForRole(strategy: IUserStrategy): ToolDefEntry[] {
  const allTools: ToolDefEntry[] = [
    {
      type: 'function',
      function: {
        name: 'confirm_booking',
        description: 'Crea una cita nueva. Requiere service_id, date, time y uno de: client_name (búsqueda fuzzy) o client_id (UUID exacto si lo conoces de create_client).',
        parameters: {
          type: 'object',
          properties: {
            service_id:  { type: 'string', description: 'UUID del servicio (usar el id exacto de la lista de servicios)' },
            client_name: { type: 'string', description: 'Nombre del cliente para búsqueda. Omitir si ya tienes client_id.' },
            client_id:   { type: 'string', description: 'UUID del cliente. Usar cuando venga de create_client. Tiene prioridad sobre client_name.' },
            date:        { type: 'string', description: 'Fecha YYYY-MM-DD' },
            time:        { type: 'string', description: 'Hora HH:mm en formato 24h' },
            staff_id:    { type: 'string', description: 'UUID del empleado asignado (opcional)' },
          },
          required: ['service_id', 'date', 'time'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_booking',
        description: 'Cancela una cita existente. Requiere appointment_id.',
        parameters: {
          type: 'object',
          properties: {
            appointment_id: { type: 'string', description: 'UUID de la cita' },
          },
          required: ['appointment_id'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'reschedule_booking',
        description: 'Reagenda una cita. Requiere appointment_id, new_date, new_time.',
        parameters: {
          type: 'object',
          properties: {
            appointment_id: { type: 'string', description: 'UUID de la cita' },
            new_date: { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
            new_time: { type: 'string', description: 'Nueva hora HH:mm 24h' },
          },
          required: ['appointment_id', 'new_date', 'new_time'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_appointments_by_date',
        description: 'Consulta citas de un día específico.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Fecha YYYY-MM-DD' },
          },
          required: ['date'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_services',
        description: 'Lista los servicios disponibles.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_available_slots',
        description: 'Consulta los horarios disponibles para un día y duración de servicio específicos.',
        parameters: {
          type: 'object',
          properties: {
            date:         { type: 'string', description: 'Fecha YYYY-MM-DD' },
            duration_min: { type: 'number', description: 'Duración del servicio en minutos' },
          },
          required: ['date', 'duration_min'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_client',
        description: 'Registra un cliente nuevo en el sistema. Usar cuando el cliente no existe aún.',
        parameters: {
          type: 'object',
          properties: {
            name:  { type: 'string', description: 'Nombre completo del cliente' },
            phone: { type: 'string', description: 'Teléfono del cliente (opcional)' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
  ]

  // Filter tools based on strategy permissions
  return allTools.filter((tool) => strategy.canExecute(tool.function.name))
}
