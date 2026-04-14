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

    // ── 2b. Active collection flow — continue regardless of text intent ──────
    // If we're already collecting data, stay in collection mode.
    // The user's response is assumed to be answering the missing field question.
    if (state.flow === 'collecting_booking' || state.flow === 'collecting_reschedule') {
      const requiredFields = strategy.getRequiredBookingFields()

      // Extract any entities from this turn
      const entities = extractEntities(input.text)
      const collectionNormalized = normalizeForMatch(input.text)

      // Merge new entities with existing draft
      const updatedDraft: Record<string, unknown> = {
        ...(state.draft as Record<string, unknown>),
        ...entities,
      }

      // For booking flows, try to infer missing fields from context:
      // If the text doesn't contain a date/time, it's likely a name or service
      if (!entities.date && !entities.time) {
        // Check if it might be a client name
        if (!updatedDraft.clientName && !updatedDraft.clientId) {
          // Text that doesn't match service-like patterns → treat as client name
          const isServiceLike = collectionNormalized.includes('servicio') || collectionNormalized.includes('corte') ||
            collectionNormalized.includes('tinte') || collectionNormalized.includes('peinado') ||
            collectionNormalized.includes('manicure') || collectionNormalized.includes('masaje')
          if (!isServiceLike) {
            updatedDraft.clientName = input.text.trim()
          }
        }
      }

      const missingFields = requiredFields.filter((field) => {
        const value = updatedDraft[field]
        return value === undefined || value === null || value === ''
      })

      if (missingFields.length === 0) {
        // All data collected
        if (strategy.requiresConfirmation(state)) {
          return {
            type: 'await_confirmation',
            intent: state.lastIntent ?? 'booking',
            summary: strategy.buildConfirmationPrompt(updatedDraft as ConversationState['draft']),
          }
        }

        const intent = state.lastIntent ?? 'booking'
        return {
          type: 'execute_immediately',
          intent,
          args: updatedDraft,
        }
      }

      return {
        type: 'continue_collection',
        intent: state.lastIntent ?? 'booking',
        missingFields,
        prompt: strategy.buildCollectionPrompt(missingFields[0] ?? 'info', updatedDraft as ConversationState['draft']),
        extractedData: entities,
        updatedDraft,
      }
    }

    // ── 3. Extract entities from text (date, time, etc.) ─────────────────────
    const entities = extractEntities(input.text)

    // ── 4. Fast path: explicit booking intent with sufficient data ───────────
    if (detectBookingIntent(input.text)) {
      const requiredFields = strategy.getRequiredBookingFields()

      // Merge extracted entities into potential args
      const mergedArgs: Record<string, unknown> = {
        ...entities,
      }

      // If we have a draft, merge existing data
      if (state.draft) {
        for (const [key, value] of Object.entries(state.draft)) {
          if (value !== undefined && value !== null) {
            mergedArgs[key] = value
          }
        }
      }

      // Check if we have all required fields
      const missingFields = requiredFields.filter((field) => {
        const value = (mergedArgs as Record<string, unknown>)[field]
        return value === undefined || value === null || value === ''
      })

      if (missingFields.length === 0) {
        // All data present
        if (strategy.requiresConfirmation(state) && state.flow !== 'awaiting_confirmation') {
          return {
            type: 'await_confirmation',
            intent: 'booking',
            summary: strategy.buildConfirmationPrompt({
              ...state.draft,
              ...entities,
            } as ConversationState['draft']),
          }
        }

        return {
          type: 'execute_immediately',
          intent: 'booking',
          args: mergedArgs,
        }
      }

      // Missing fields → start collection
      return {
        type: 'continue_collection',
        intent: 'booking',
        missingFields,
        prompt: strategy.buildCollectionPrompt(missingFields[0] ?? 'info', {
          ...state.draft,
          ...entities,
        } as ConversationState['draft']),
        extractedData: entities,
        updatedDraft: mergedArgs,
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

  let prompt = `Eres el asistente de IA de "${input.context.businessName}". Español únicamente.`
  prompt += `\nHOY: ${now} | Zona horaria: ${input.timezone}`
  prompt += `\nUsuario: ${input.userName ?? 'Usuario'} (${input.userRole})`

  // Inject services if available
  if (input.context.services && input.context.services.length > 0) {
    prompt += '\n\nSERVICIOS:'
    for (const svc of input.context.services) {
      prompt += `\n- ${svc.name} (${svc.duration_min} min, $${svc.price})`
    }
  }

  // Inject active appointments if available
  if (input.context.activeAppointments && input.context.activeAppointments.length > 0) {
    prompt += '\n\nCITAS ACTIVAS:'
    for (const apt of input.context.activeAppointments.slice(0, 5)) {
      prompt += `\n- ${apt.clientName}: ${apt.serviceName} el ${apt.startAt} (${apt.status})`
    }
  }

  // Inject AI rules if configured
  if (input.context.aiRules) {
    prompt += `\n\nREGLAS: ${input.context.aiRules}`
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
        description: 'Crea una cita nueva. Requiere service_id, date, time.',
        parameters: {
          type: 'object',
          properties: {
            service_id: { type: 'string', description: 'UUID del servicio' },
            date: { type: 'string', description: 'Fecha YYYY-MM-DD' },
            time: { type: 'string', description: 'Hora HH:mm 24h' },
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
  ]

  // Filter tools based on strategy permissions
  return allTools.filter((tool) => strategy.canExecute(tool.function.name))
}
