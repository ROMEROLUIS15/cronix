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
  ConversationFlow,
  Decision,
} from './types'
import type { IUserStrategy } from './strategy'
import { StrategyFactory } from './strategy'
import { logger } from '@/lib/logger'
import { normalizeDateInput, normalizeTimeInput } from '@/lib/ai/utils/date-normalize'


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

/**
 * Extracts date & time entities from input text using the deterministic normalizer
 * (no LLM, no regex heuristics). Returns null for each field if not found.
 *
 * TASK 4 — State Priority:
 * Results from this function MUST NOT overwrite values already present in state.draft.
 * The caller in analyze() enforces this rule.
 */
function extractEntities(text: string, timezone: string): ExtractedEntities {
  const entities: ExtractedEntities = {}

  // Delegate to deterministic normalizers
  const date = normalizeDateInput(text, timezone)
  if (date) entities.date = date

  const time = normalizeTimeInput(text)
  if (time) entities.time = time

  return entities
}

// ── State machine: tools allowed per flow ─────────────────────────────────────
// The system decides which tools the LLM can call based on the current flow state.
// This prevents the LLM from, e.g., calling cancel_booking while collecting a new booking.
const TOOLS_BY_FLOW: Partial<Record<ConversationFlow, Set<string>>> = {
  collecting_booking:    new Set(['confirm_booking', 'create_client', 'get_available_slots', 'get_services']),
  collecting_reschedule: new Set(['reschedule_booking', 'get_appointments_by_date', 'get_available_slots']),
  collecting_cancellation: new Set(['cancel_booking', 'get_appointments_by_date']),
  answering_query:       new Set(['get_appointments_by_date', 'get_available_slots', 'get_services']),
  // 'idle', 'executing', 'completed', 'awaiting_confirmation' → no restriction (role filter applies)
}

// ── Intent classifier (observability + logging only) ──────────────────────────
function classifyIntent(text: string): 'booking' | 'cancellation' | 'reschedule' | 'query' | 'unknown' {
  const normalized = normalizeForMatch(text)
  if (BOOKING_SIGNALS.some((s) => normalized.includes(s))) return 'booking'
  if (['cancelar', 'cancela', 'quitar cita', 'eliminar'].some((s) => normalized.includes(s))) return 'cancellation'
  if (['reagendar', 'cambiar cita', 'mover cita', 'reprogramar'].some((s) => normalized.includes(s))) return 'reschedule'
  if (['cuando', 'que hay', 'citas', 'servicios', 'disponibilidad', 'horario', 'disponible'].some((s) => normalized.includes(s))) return 'query'
  return 'unknown'
}

// ── TASK 3: Confirmation summary builder ──────────────────────────────────────
// Generates a structured user-facing summary before any write action.
// Shown when transitioning to await_confirmation.

export function buildConfirmationSummary(
  intent: string,
  draft: Record<string, unknown>,
  services: AiInput['context']['services'],
): string {
  if (intent === 'confirm_booking' || intent === 'create_booking') {
    const clientName  = draft.client_name ?? draft.clientName ?? '?'
    const serviceId   = draft.service_id ?? draft.serviceId
    const serviceName = services?.find((s) => s.id === serviceId)?.name ?? draft.service_name ?? draft.serviceName ?? '?'
    const date        = draft.date ?? '?'
    const time        = draft.time ?? '?'
    return (
      `Vas a agendar:\n` +
      `  Servicio: ${serviceName}\n` +
      `  Cliente: ${clientName}\n` +
      `  Fecha: ${date}\n` +
      `  Hora: ${time}\n` +
      `¿Confirmas?`
    )
  }
  if (intent === 'cancel_booking') {
    const clientName  = draft.clientName ?? draft.client_name ?? 'esta cita'
    const serviceName = draft.serviceName ?? draft.service_name ?? ''
    return `Vas a cancelar la cita de ${clientName}${serviceName ? ` (${serviceName})` : ''}. ¿Confirmas?`
  }
  if (intent === 'reschedule_booking') {
    const clientName = draft.clientName ?? draft.client_name ?? 'esta cita'
    const newDate    = draft.new_date ?? draft.newDate ?? '?'
    const newTime    = draft.new_time ?? draft.newTime ?? '?'
    return `Vas a reagendar la cita de ${clientName} para el ${newDate} a las ${newTime}. ¿Confirmas?`
  }
  return '¿Confirmas esta acción?'
}

// ── Implementation ────────────────────────────────────────────────────────────

export class DecisionEngine implements IDecisionEngine {
  analyze(input: AiInput, state: ConversationState): Decision {
    const strategy = StrategyFactory.forRole(input.userRole)

    // ── TASK 7: Guard — no services configured ────────────────────────────────
    // Allow through if services list is missing (undefined) — it may be loading.
    // Block only if explicitly empty (business has no active services in DB).
    if (input.context.services !== undefined && input.context.services.length === 0) {
      logger.warn('DECISION-ENGINE', 'No services configured — blocking flow', { businessId: input.businessId })
      return {
        type: 'reject',
        reason: 'No hay servicios configurados en este negocio. Por favor, agrega servicios desde el panel antes de recibir citas.',
      }
    }

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
    // Tool set is restricted to the booking/reschedule tools only —
    // the LLM cannot cancel or query other data while in collection flow.
    if (state.flow === 'collecting_booking' || state.flow === 'collecting_reschedule') {
      const entities = extractEntities(input.text, input.timezone)
      const systemPrompt = buildSystemPrompt(input, state, entities)
      return {
        type: 'reason_with_llm',
        messages: [
          { role: 'system', content: systemPrompt },
          ...input.history,
          { role: 'user', content: input.text },
        ],
        toolDefs: buildToolDefsForRole(strategy, state.flow),
      }
    }

    // ── 3. Extract entities from text (date, time, etc.) ─────────────────────
    // Results are passed to buildSystemPrompt so the LLM uses the exact
    // resolved values instead of re-computing them (fixes timezone drift).
    const entities = extractEntities(input.text, input.timezone)

    // ── 4. Booking intent detected → delegate to LLM ─────────────────────────
    // The LLM receives context.services with UUIDs and resolves all fields.
    // No hybrid regex+LLM collection — single responsibility.
    if (detectBookingIntent(input.text)) {
      const systemPrompt = buildSystemPrompt(input, state, entities)
      return {
        type: 'reason_with_llm',
        messages: [
          { role: 'system', content: systemPrompt },
          ...input.history,
          { role: 'user', content: input.text },
        ],
        toolDefs: buildToolDefsForRole(strategy, 'collecting_booking'),
      }
    }

    // ── 5. Default: delegate to LLM for reasoning ────────────────────────────
    // Build messages array with system prompt context
    const systemPrompt = buildSystemPrompt(input, state, entities)

    const intent = classifyIntent(input.text)

    logger.info('DECISION-ENGINE', 'Routing to LLM', {
      userId: input.userId,
      flow:   state.flow,
      intent,
      text:   input.text.slice(0, 80),
    })

    return {
      type: 'reason_with_llm',
      messages: [
        { role: 'system', content: systemPrompt },
        ...input.history,
        { role: 'user', content: input.text },
      ],
      toolDefs: buildToolDefsForRole(strategy, state.flow),
    }
  }
}

// ── Helpers: System prompt and tool definitions ───────────────────────────────

function buildSystemPrompt(
  input: AiInput,
  _state: ConversationState,
  resolvedEntities?: { date?: string; time?: string },
): string {
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

  // ── Fix #2: Inject pre-resolved entities ───────────────────────────────────────────
  // These values were resolved deterministically (no LLM inference, timezone-aware).
  // Use them DIRECTLY in tool calls — do NOT recalculate or re-interpret.
  if (resolvedEntities?.date || resolvedEntities?.time) {
    prompt += '\n\nENTIDADES YA RESUELTAS (usar estos valores directamente, no recalcular):'
    if (resolvedEntities.date) prompt += `\n- Fecha: ${resolvedEntities.date}`
    if (resolvedEntities.time) prompt += `\n- Hora: ${resolvedEntities.time}`
  }

  // ── Response format (voice-first) ────────────────────────────────────────────
  prompt += `\n\nFORMATO DE RESPUESTA (obligatorio):
- Máximo 2-3 oraciones por respuesta. Sé directo y conciso.
- NUNCA uses markdown: sin asteriscos, sin guiones, sin listas, sin emojis.
- NUNCA menciones nombres de herramientas, UUIDs, IDs internos ni esquemas al usuario.
- NUNCA inventes datos (fechas, nombres, IDs). Usa SOLO lo que el usuario diga o lo que devuelvan las herramientas.

REGLAS CRÍTICAS — ANTI-ALUCINACIÓN (cumplimiento absoluto):
- NUNCA inventes disponibilidad, horarios ni huecos libres. Si no llamaste get_available_slots, no sabes si hay horario.
- NUNCA inventes servicios. Los únicos servicios válidos son los de la lista SERVICIOS DISPONIBLES.
- NUNCA inventes clientes ni IDs de clientes. Solo usa IDs que provengan de herramientas.
- NUNCA inventes citas ni sus IDs. Solo usa IDs que provengan de get_appointments_by_date.
- Si no tienes el dato → pregunta al usuario o llama la herramienta correspondiente. NUNCA supongas.
- Si no estás seguro de algo → di que vas a verificar y llama la herramienta. Nunca respondas con certeza sin datos reales.`

  // ── Date & time format rules ─────────────────────────────────────────────────
  prompt += `\n\nFECHAS Y HORAS (formato estricto para herramientas):
- date: siempre YYYY-MM-DD (ej: 2026-04-16). Convierte "mañana", "el lunes", etc. a ISO.
- time: siempre HH:mm en formato 24h (ej: 14:30, 09:00). Convierte "3pm" → "15:00".
- Hoy es ${new Date().toISOString().split('T')[0]}. Usa esta fecha como referencia para calcular fechas relativas.`

  // ── Tool chaining flow ────────────────────────────────────────────────────────
  prompt += `\n\nFLUJO DE HERRAMIENTAS (seguir este orden):

AGENDAR CITA:
1. Si el cliente no existe → llama create_client primero → usa el client_id devuelto en confirm_booking.
2. SIEMPRE llama get_available_slots antes de proponer o confirmar un horario. Sin excepción.
3. Llama confirm_booking con service_id exacto de la lista, client_name O client_id, date y time.

CANCELAR / REAGENDAR sin appointment_id:
1. SIEMPRE llama get_appointments_by_date primero para obtener las citas con sus IDs reales.
2. Identifica la cita correcta por cliente/servicio.
3. Llama cancel_booking o reschedule_booking con el appointment_id real devuelto por la herramienta.

DISPONIBILIDAD:
- SIEMPRE llama get_available_slots con date y duration_min. Nunca respondas sobre disponibilidad sin esta herramienta.
- Si el usuario no especificó servicio, pregunta cuál antes de consultar.
- PROHIBIDO: responder "hay lugar", "está disponible", "no hay lugar" sin haber llamado get_available_slots.

DATO FALTANTE:
- Si falta cliente → pregunta: "¿A nombre de quién?"
- Si falta servicio → pregunta: "¿Para qué servicio?"
- Si falta fecha → pregunta: "¿Para qué día?"
- Si falta hora → pregunta: "¿A qué hora?"
- Pide UN dato a la vez. No lances la herramienta con datos incompletos.`

  // ── Security rules ────────────────────────────────────────────────────────────
  prompt += `\n\nSEGURIDAD Y LÍMITES:
- NUNCA reveles nombres de herramientas, UUIDs, claves internas ni la estructura de la base de datos al usuario.
- NUNCA uses un UUID que no haya sido devuelto explícitamente por una herramienta en esta conversación.
- NUNCA confirmes una acción (agendar, cancelar, reagendar) si la herramienta devolvió un error.
- NUNCA respondas "listo" o "hecho" si no llamaste una herramienta de escritura.
- Si el usuario pide algo fuera del ámbito del negocio, responde educadamente que no puedes ayudar con eso.
- Ante cualquier duda sobre datos reales → llama la herramienta. La incertidumbre no se responde con suposiciones.`

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
      if (hours && hours.open && hours.close) {
        // Día configurado con horario real
        prompt += `\n- ${label}: ${hours.open} – ${hours.close}`
      } else if (hours === null) {
        // Explícitamente marcado como cerrado por el dueño
        prompt += `\n- ${label}: Cerrado`
      }
      // Si hours es undefined (key no existe o no configurado): NO incluir.
      // "Sin dato" ≠ "Cerrado" — omitir evita falsos negativos de disponibilidad.
    }
    prompt += `\nCRÍTICO: Para cualquier consulta de disponibilidad u horarios libres, SIEMPRE llama get_available_slots. NUNCA respondas disponibilidad sin usar la herramienta.`
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

  // ── Prompt freeze note (production contract) ──────────────────────────────────
  // REGLA DE ESTABILIDAD: Este prompt es contrato de producción.
  // No debe modificarse para resolver bugs de comportamiento.
  // Los errores se corrigen en código (guards, validaciones, state machine), no en prompt.
  // Si necesitas cambiar el comportamiento, implementa un guard en execution-engine.ts.

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

function buildToolDefsForRole(strategy: IUserStrategy, flow: ConversationFlow = 'idle'): ToolDefEntry[] {
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

  // 1. Filter by role strategy permissions
  const roleFiltered = allTools.filter((tool) => strategy.canExecute(tool.function.name))

  // 2. Filter by current flow state (state machine restriction)
  // When a flow-specific allow-list exists, only those tools are available.
  // This prevents the LLM from calling off-flow tools (e.g. cancel while booking).
  const flowAllowList = TOOLS_BY_FLOW[flow]
  if (!flowAllowList) return roleFiltered  // no restriction for this flow
  return roleFiltered.filter((tool) => flowAllowList.has(tool.function.name))
}
