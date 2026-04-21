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

// ── Helper: Detect anaphora (refer to previous entity) ─────────────────────────
// "esta cita", "esa cita", "la misma", "reagéndala" → resolve via entityContext

function detectAnaphora(text: string): boolean {
  return ANAPHORA_PATTERN.test(text)
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

// ── Owner fast-path patterns ─────────────────────────────────────────────────────────
// Matched against RAW input text (not normalized) using the `i` flag.
// Short-circuit the LLM entirely for zero-latency owner operations.

/** "qué tengo hoy", "citas de hoy", "agenda de hoy", "mis citas" */
const TODAY_QUERY_PATTERN    = /qu[eé]\s+tengo\s+hoy|citas?\s+de?\s+hoy|agenda\s+d[e]?\s+hoy|mis\s+citas/i
/** "qué tengo mañana", "citas de mañana", "agenda de mañana" */
const TOMORROW_QUERY_PATTERN = /qu[eé]\s+tengo\s+ma[nñ]ana|citas?\s+de\s+ma[nñ]ana|agenda\s+d[e]?\s+ma[nñ]ana/i
/** "cancela la última", "cancela lo último", "cancela eso", "elimina la cita" */
const CANCEL_LAST_PATTERN    = /cancel[ae][rs]?\s+(l[ao]\s+)?[úu]ltim[ao]|cancela\s+eso|elimin[ae].*cita/i
/** Anaphora patterns: "esta cita", "esa cita", "la misma", "la de antes", "reagéndala", "cancélala", etc. */
const ANAPHORA_PATTERN       = /(?:esta|esa|la|la\s+misma|la\s+de\s+antes|lo\s+mismo)\s+cita|reagéndala|cancélala|la\s+cita$/i


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

// ── Owner fast-path: direct booking entity extraction ────────────────────────
// Used by fast-path D to bypass the LLM when the owner sends a complete booking
// command from idle state (e.g. "Agéndame a Alan mañana corte a las 9").
// All functions are deterministic and timezone-aware — no LLM involved.

const OWNER_BOOKING_SIGNALS = [
  'agendar', 'agenda', 'agendame', 'reservar', 'reserva', 'programar', 'programa',
]

function detectOwnerBookingIntent(text: string): boolean {
  const n = normalizeForMatch(text)
  return OWNER_BOOKING_SIGNALS.some((s) => n === s || n.startsWith(s + ' '))
}

/**
 * Fuzzy-matches a service name from free text against the business catalog.
 * Tries exact service name match first, then significant-word match (>3 chars).
 */
function fuzzyMatchService(
  text: string,
  services: AiInput['context']['services'],
): { id: string; name: string } | null {
  if (!services || services.length === 0) return null
  const n = normalizeForMatch(text)
  for (const svc of services) {
    const svcN = normalizeForMatch(svc.name)
    if (n.includes(svcN)) return { id: svc.id, name: svc.name }
    const words = svcN.split(/\s+/).filter((w) => w.length > 3)
    if (words.length > 0 && words.some((w) => n.includes(w))) return { id: svc.id, name: svc.name }
  }
  return null
}

/**
 * Extracts client name from owner booking text.
 * Handles: "agéndame a [Name]", "a nombre de [Name]", "cita de/para [Name]"
 */
function extractClientNameFromOwnerText(text: string): string | null {
  const n = normalizeForMatch(text)
  const STOPWORDS = new Set(['las', 'los', 'una', 'para', 'el', 'la', 'les', 'les'])
  const toTitle = (s: string) =>
    s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  // "a [Name]" followed by a date/service/time signal
  const afterA = n.match(
    /\ba\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|el\s+\d|para|\d)/,
  )
  if (afterA?.[1]) {
    const candidate = afterA[1].trim()
    if (!STOPWORDS.has(candidate.split(' ')[0] ?? '')) return toTitle(candidate)
  }

  // "a nombre de [Name]"
  const nombreDe = n.match(/\ba\s+nombre\s+de\s+([a-z]+(?:\s+[a-z]+)?)/)
  if (nombreDe?.[1]) return toTitle(nombreDe[1].trim())

  // "cita de/para [Name]"
  const citaDe = n.match(/\bcita\s+(?:de|para)\s+([a-z]+(?:\s+[a-z]+)?)/)
  if (citaDe?.[1]) return toTitle(citaDe[1].trim())

  return null
}

/**
 * Extends normalizeTimeInput with a fallback for bare "las X" patterns.
 * Business heuristic for bare hours: 1–6 → PM, 7–12 → AM.
 */
function extractOwnerTime(text: string): string | null {
  const t = normalizeTimeInput(text)
  if (t) return t

  const n = normalizeForMatch(text)
  const match = n.match(/\blas?\s+(\d{1,2})\b/)
  if (match?.[1]) {
    const h = parseInt(match[1], 10)
    if (h >= 1 && h <= 23) {
      const finalH = h >= 1 && h <= 6 ? h + 12 : h
      return `${String(finalH).padStart(2, '0')}:00`
    }
  }
  return null
}

/**
 * Orchestrates deterministic extraction of all booking fields from owner input.
 */
function extractOwnerBookingData(
  text: string,
  timezone: string,
  services: AiInput['context']['services'],
): { date: string | null; time: string | null; serviceId: string | null; serviceName: string | null; clientName: string | null } {
  const svc = fuzzyMatchService(text, services)
  return {
    date:        normalizeDateInput(text, timezone),
    time:        extractOwnerTime(text),
    serviceId:   svc?.id   ?? null,
    serviceName: svc?.name ?? null,
    clientName:  extractClientNameFromOwnerText(text),
  }
}

// ── Helper: Draft completeness check ──────────────────────────────────────────
// Used as a fast-path guard in analyze() to skip the LLM loop entirely when all
// required booking fields are already present in the conversation draft.
// Does NOT validate field values — only checks presence.

function isDraftComplete(draft: ConversationState['draft']): boolean {
  if (!draft) return false
  const d = draft as Record<string, unknown>
  return (
    Boolean(d['service_id']) &&
    Boolean(d['date']) &&
    Boolean(d['time']) &&
    Boolean(d['client_name'] ?? d['client_id'])
  )
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

    // ── Owner fast-paths: zero-LLM execution for common operations ────────────────
    // Bypass the LLM entirely for latency-sensitive admin/staff actions.
    // These run before the awaiting_confirmation check so they always fire,
    // even if the owner/staff was mid-flow (signals intent to start a new operation).
    if (input.userRole !== 'external') {

      // Fast path A — "¿qué tengo hoy?" → direct date query, no LLM
      if (TODAY_QUERY_PATTERN.test(input.text)) {
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone })
        logger.info('DECISION-ENGINE', 'Owner fast-path: today query', { userId: input.userId, date: todayStr })
        return { type: 'answer_query', toolName: 'get_appointments_by_date', args: { date: todayStr } }
      }

      // Fast path B — "¿qué tengo mañana?" → direct date query, no LLM
      if (TOMORROW_QUERY_PATTERN.test(input.text)) {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        const tomorrowStr = d.toLocaleDateString('en-CA', { timeZone: input.timezone })
        logger.info('DECISION-ENGINE', 'Owner fast-path: tomorrow query', { userId: input.userId, date: tomorrowStr })
        return { type: 'answer_query', toolName: 'get_appointments_by_date', args: { date: tomorrowStr } }
      }

      // Fast path C — "cancela la última" + session has appointmentId → direct cancel
      // Only fires if state.lastAction is populated (i.e. a write-action was performed
      // in this session). Never invents an appointmentId.
      if (CANCEL_LAST_PATTERN.test(input.text) && state.lastAction?.appointmentId) {
        logger.info('DECISION-ENGINE', 'Owner fast-path: cancel last action', {
          userId:        input.userId,
          appointmentId: state.lastAction.appointmentId,
        })
        return {
          type:   'execute_immediately',
          intent: 'cancel_booking',
          args:   { appointment_id: state.lastAction.appointmentId },
        }
      }

      // Fast path C2 — Anaphora resolution: "cancela esta cita", "reagéndala", etc.
      // Resolves via entityContext.lastAppointmentId persisted from Redis
      if (detectAnaphora(input.text) && input.entityContext?.lastAppointmentId) {
        const intent = input.text.toLowerCase().includes('cancel') ? 'cancel_booking' : 'reschedule'
        logger.info('DECISION-ENGINE', 'Owner anaphora resolution fast-path', {
          userId:        input.userId,
          appointmentId: input.entityContext.lastAppointmentId,
          intent,
        })

        if (intent === 'cancel_booking') {
          return {
            type:   'execute_immediately',
            intent: 'cancel_booking',
            args:   { appointment_id: input.entityContext.lastAppointmentId },
          }
        } else {
          // Reschedule needs date/time, pass to LLM with pre-resolved appointment
          return {
            type: 'reason_with_llm',
            messages: [
              {
                role: 'system',
                content: `El usuario se refiere a la cita con ID ${input.entityContext.lastAppointmentId}. ` +
                         `Esta cita es: Cliente "${input.entityContext.lastClientName}", ` +
                         `Servicio "${input.entityContext.lastServiceName}", ` +
                         `Fecha ${input.entityContext.lastDate}. ` +
                         `Necesitas obtener la nueva fecha/hora del usuario para reagendar.`,
              },
              ...input.history,
              { role: 'user', content: input.text },
            ],
            toolDefs: buildToolDefsForRole(strategy, 'collecting_reschedule'),
          }
        }
      }

      // Fast path D — direct booking from owner input (e.g. "Agéndame a Alan mañana corte a las 9").
      // Only triggers from idle state — avoids interfering with ongoing collection flows.
      // When all fields are extracted deterministically: zero LLM calls, immediate execution.
      if (state.flow === 'idle' && detectOwnerBookingIntent(input.text)) {
        const parsed = extractOwnerBookingData(input.text, input.timezone, input.context.services)
        logger.info('DECISION-ENGINE', 'Owner fast-path D: parsed booking entities', {
          userId:    input.userId,
          date:      parsed.date,
          time:      parsed.time,
          serviceId: parsed.serviceId,
          hasClient: Boolean(parsed.clientName),
        })

        if (parsed.date && parsed.time && parsed.serviceId) {
          // All required fields present → execute immediately, zero LLM calls
          return {
            type:   'execute_immediately',
            intent: 'confirm_booking',
            args: {
              service_id: parsed.serviceId,
              date:       parsed.date,
              time:       parsed.time,
              ...(parsed.clientName ? { client_name: parsed.clientName } : {}),
            },
          }
        }

        // Partial data → ask only the one missing field, carry extracted fields in draft
        const partialDraft: Record<string, string | undefined> = {}
        if (parsed.serviceId)  partialDraft['service_id']  = parsed.serviceId
        if (parsed.date)       partialDraft['date']         = parsed.date
        if (parsed.time)       partialDraft['time']         = parsed.time
        if (parsed.clientName) partialDraft['client_name'] = parsed.clientName

        if (Object.keys(partialDraft).length > 0) {
          const missingField = !parsed.serviceId ? 'service_id'
            : !parsed.date                       ? 'date'
            : !parsed.time                       ? 'time'
            : null

          if (missingField) {
            const prompt = missingField === 'service_id' ? '¿Para qué servicio?'
              : missingField === 'date'                  ? '¿Para qué día?'
              : '¿A qué hora?'
            return {
              type:          'continue_collection',
              intent:        'confirm_booking',
              missingFields: [missingField],
              prompt,
              extractedData: partialDraft,
              updatedDraft:  partialDraft,
            }
          }
        }
        // Nothing extracted deterministically → fall through to LLM
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
      // ── Fast path: if draft already has all required fields, skip the LLM ──
      // Going into the LLM loop with a complete draft causes it to ask more
      // questions needlessly. Go directly to await_confirmation instead.
      if (state.flow === 'collecting_booking' && isDraftComplete(state.draft)) {
        logger.info('DECISION-ENGINE', 'Draft complete — fast-path to await_confirmation', {
          userId:    input.userId,
          serviceId: (state.draft as Record<string, unknown>)?.['service_id'],
          date:      (state.draft as Record<string, unknown>)?.['date'],
        })
        return {
          type:    'await_confirmation',
          intent:  'confirm_booking',
          summary: buildConfirmationSummary(
            'confirm_booking',
            state.draft as Record<string, unknown>,
            input.context.services,
          ),
        }
      }

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
  state: ConversationState,
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
- Hoy es ${new Date().toISOString().split('T')[0]}. Usa esta fecha como referencia para calcular fechas relativas.
- NUNCA menciones el día de la semana (lunes, martes, etc.) en tus respuestas. Usa solo la fecha numérica (YYYY-MM-DD) o el texto exacto devuelto por las herramientas. El día de semana lo calcula el sistema internamente — si lo dices tú, puede ser incorrecto.`

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
- Pide UN dato a la vez. No lances la herramienta con datos incompletos.

CUANDO YA TIENES TODOS LOS DATOS (servicio + fecha + hora + cliente identificado):
- DETÉN el flujo conversacional INMEDIATAMENTE. No hagas más preguntas ni ofrezcas alternativas.
- RESPONDE SOLO con el resumen: "Perfecto. ¿Confirmo tu cita para [servicio] el [fecha] a las [hora] a nombre de [cliente]?"
- ESPERA la respuesta del usuario (sí/no). No continúes el flujo bajo ningún concepto.

SERVICIOS — RESOLUCIÓN SEMÁNTICA (HIPER FLEXIBLE):
- Mapea plurales, singulares o variantes de voz (ej. 'tarjeta' a 'Tarjetas', 'corte' a 'Cortes') al ID correcto en silencio. SÉ MUY FLEXIBLE.
- Para verificar si un servicio existe, consulta EXCLUSIVELY la lista SERVICIOS DISPONIBLES de este prompt.
- Si el usuario pide un servicio que NO aparece incluso considerando flexibilización (ej. pide manicura y solo ofreces barbería) → responde: "No veo ese servicio registrado. Los servicios disponibles son: [lista de nombres]."
- NUNCA digas "no tengo" ni "ese servicio no existe" sin haber aplicado máxima tolerancia a la pronunciación/plurales primero.
- Si hay servicios claramente ambiguos → sugiere el más cercano: "¿Querías decir [nombre del servicio]?"`

  // ── Security rules ────────────────────────────────────────────────────────────
  prompt += `\n\nSEGURIDAD Y LÍMITES:
- NUNCA reveles nombres de herramientas, UUIDs, claves internas ni la estructura de la base de datos al usuario.
- NUNCA uses un UUID que no haya sido devuelto explícitamente por una herramienta en esta conversación.
- NUNCA confirmes una acción (agendar, cancelar, reagendar) si la herramienta devolvió un error.
- NUNCA respondas "listo" o "hecho" si no llamaste una herramienta de escritura.
- Si el usuario pide algo fuera del ámbito del negocio, responde educadamente que no puedes ayudar con eso.
- Ante cualquier duda sobre datos reales → llama la herramienta. La incertidumbre no se responde con suposiciones.`

  // ── Output visibility rules (CRITICAL — non-negotiable) ────────────────────────
  // This section is an absolute output contract. Any violation causes a hard block
  // at the runtime level (execution-engine.ts sanitizeOutput + containsInternalSyntax).
  prompt += `\n\nREGLAS CRÍTICAS — VISIBILIDAD (incumplimiento invalida la respuesta):
- NUNCA muestres nombres de funciones o herramientas al usuario (confirm_booking, cancel_booking, get_available_slots, etc.).
- NUNCA muestres JSON, objetos, arrays ni estructuras de datos al usuario.
- NUNCA muestres identificadores internos: service_id, client_id, appointment_id, UUIDs, ni ninguna clave de base de datos.
- NUNCA muestres marcadores internos como [CONFIRM_booking], [CONFIRM_*] ni ninguna sintaxis entre corchetes de uso interno.
- Las herramientas se usan INTERNAMENTE y en silencio. El usuario solo ve el resultado final en lenguaje natural.
- Si vas a llamar una herramienta, hazlo sin anunciarlo. No digas "voy a llamar confirm_booking" ni nada similar.
- El canal de salida (WhatsApp, web) es SOLO para texto conversacional en español. Nada más.`

  // ── Services ──────────────────────────────────────────────────────────────────
  // ── Owner / Admin mode ────────────────────────────────────────────────────────
  // Must appear before Services so the LLM reads behavioral rules first.
  if (input.userRole !== 'external') {
    prompt += `\n\nMODO OPERADOR (eres parte del staff, comandos del panel):
- RESPUESTAS ULTRA-CORTAS. Máximo 1 oración. Sin introducciones, sin despedidas, sin preguntas de seguimiento.
- Si el cliente no existe en el sistema, llama create_client automáticamente SIN preguntar. Luego usa el client_id devuelto en confirm_booking.
- Después de agendar: "Listo. [ClientName] — [ServiceName] el [date] a las [time]."
- Después de cancelar: "Cancelado."
- Después de reagendar: "Reagendado para el [date] a las [time]."
- NO pidas confirmación al usuario antes de actuar — ejecuta directamente.
- Si falta un solo dato, pregunta SOLO ese dato en una palabra: "¿Hora?" "¿Servicio?" "¿Fecha?"`

    if (state.lastAction) {
      prompt += `\n\nÚLTIMA ACCIÓN DE SESIÓN:
- Tipo: ${state.lastAction.type}
- Cliente: ${state.lastAction.clientName}
- Servicio: ${state.lastAction.serviceName}
- Fecha: ${state.lastAction.date} | Hora: ${state.lastAction.time}
- appointment_id: ${state.lastAction.appointmentId}
Si el usuario dice "reagenda lo último" → usa este appointment_id en reschedule_booking.`
    }
  }

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
