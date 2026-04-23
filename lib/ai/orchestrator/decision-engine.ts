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
import { similarity, normalizeForFuzzy } from '@/lib/ai/fuzzy-match'
import { buildSystemPrompt } from '@/lib/ai/agents/dashboard/prompt'
import type { ResolvedEntities } from '@/lib/ai/agents/dashboard/prompt'
import { buildToolDefsForRole, TOOLS_BY_FLOW } from '@/lib/ai/agents/dashboard/tools'
import type { ToolDefEntry } from '@/lib/ai/agents/dashboard/tools'


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
/** Anaphora patterns (demostrativos estrictos): "esta cita", "esa cita", "la misma", "la de antes", "reagéndala", "cancélala".
 *  NO incluye "la cita" genérico para evitar disparo en "cancela la cita de Luis". */
const ANAPHORA_PATTERN       = /\b(?:esta|esa|aquella|la\s+misma|la\s+de\s+antes|esa\s+misma|lo\s+mismo)\s+cita\b|\breag[eé]ndala\b|\bcanc[eé]lala\b/i


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

// TOOLS_BY_FLOW and buildToolDefsForRole live in lib/ai/agents/dashboard/tools.ts

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
 * Fuzzy-matches a service name embedded in free user text against the business catalog.
 *
 * Three-layer strategy (best→weakest):
 *   1. Substring on normalized text — "tarjetas" finds catalog entry "Tarjetas".
 *   2. Word-level Levenshtein — handles singular↔plural (tarjeta/tarjetas,
 *      corte/cortes, cabello/cabellos) and typos (cabeyo→cabello) via
 *      similarity ≥ 0.82 on at least one word pair.
 *   3. No match → null (LLM path handles disambiguation via prompt flexibility rules).
 *
 * Why not reuse `fuzzyFind`: that helper compares one entity's name head-to-head
 * with a spoken name. Here the service name is *embedded* in a longer utterance
 * ("agenda a Juan el 3 de mayo con tarjetas") so we scan words instead.
 */
const SERVICE_WORD_MATCH_THRESHOLD = 0.82
function fuzzyMatchService(
  text: string,
  services: AiInput['context']['services'],
): { id: string; name: string } | null {
  if (!services || services.length === 0) return null

  const textNorm  = normalizeForFuzzy(text)
  const textWords = textNorm.split(/\s+/).filter((w) => w.length >= 3)

  let best: { svc: { id: string; name: string }; score: number } | null = null

  for (const svc of services) {
    const svcNorm = normalizeForFuzzy(svc.name)

    // Layer 1: direct substring match — highest confidence, short-circuit.
    if (textNorm.includes(svcNorm)) {
      return { id: svc.id, name: svc.name }
    }

    // Layer 2: word-level Levenshtein — catches singular/plural variants and typos.
    const svcWords = svcNorm.split(/\s+/).filter((w) => w.length >= 3)
    for (const sw of svcWords) {
      for (const tw of textWords) {
        const s = similarity(sw, tw)
        if (s >= SERVICE_WORD_MATCH_THRESHOLD && (!best || s > best.score)) {
          best = { svc: { id: svc.id, name: svc.name }, score: s }
        }
      }
    }
  }

  return best?.svc ?? null
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
      const resolved = mergeResolvedEntities(entities, state.draft, input.context.services)
      const systemPrompt = buildSystemPrompt(input, state, resolved)
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
    const resolved = mergeResolvedEntities(entities, state.draft, input.context.services)

    // ── 4. Booking intent detected → delegate to LLM ─────────────────────────
    // The LLM receives context.services with UUIDs and resolves all fields.
    // No hybrid regex+LLM collection — single responsibility.
    if (detectBookingIntent(input.text)) {
      const systemPrompt = buildSystemPrompt(input, state, resolved)
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
    const systemPrompt = buildSystemPrompt(input, state, resolved)

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


/**
 * Fuses current-turn extracted entities with surviving draft fields so the
 * system prompt tells the LLM everything already known.
 *
 * Precedence: current-turn extraction > draft (newer info wins for date/time).
 * Service name is resolved from the services catalog when the draft only has a UUID.
 */
function mergeResolvedEntities(
  extracted: ExtractedEntities,
  draft: ConversationState['draft'],
  services: AiInput['context']['services'],
): ResolvedEntities {
  const d = draft as Record<string, string | undefined> | null

  let serviceName: string | undefined
  if (d?.['service_id'] && services) {
    serviceName = services.find((s) => s.id === d['service_id'])?.name ?? d['service_name']
  } else if (d?.['service_name']) {
    serviceName = d['service_name']
  }

  return {
    date:        extracted.date ?? d?.['date'],
    time:        extracted.time ?? d?.['time'],
    clientName:  d?.['client_name'],
    serviceName,
  }
}

