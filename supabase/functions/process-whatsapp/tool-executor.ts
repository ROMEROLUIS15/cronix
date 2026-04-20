/**
 * Tool Executor — WhatsApp AI Agent
 *
 * Contains the booking tool definitions (JSON Schema for the LLM) and the
 * runtime executor that maps LLM tool calls to DB mutations.
 *
 * Exposes:
 *  - BOOKING_TOOLS     → tool definitions array passed to the LLM
 *  - executeToolCall   → dispatches a ToolCall to the correct DB operation
 */

import type { BusinessRagContext } from "./types.ts"
import { addBreadcrumb, captureException } from "../_shared/sentry.ts"
import { checkBookingRateLimit }                               from "./guards.ts"
import { localTimeToUTC, utcToLocalParts }                      from "./time-utils.ts"
import {
  createAppointment,
  rescheduleAppointment,
  cancelAppointmentById,
  getAppointmentDetails,
} from "./appointment-repo.ts"
import type { ToolCall } from "./groq-client.ts"
import { formatLocalTime } from "./prompt-builder.ts"
import {
  emitCreatedEvent,
  emitRescheduledEvent,
  emitCancelledEvent,
} from "./notifications.ts"

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const BOOKING_TOOLS = [
  {
    type: 'function',
    function: {
      name:        'confirm_booking',
      description: 'Crea una cita nueva. Llamar SOLO después de que el cliente haya confirmado explícitamente con "sí" o equivalente. Si retorna success=false con error SLOT_CONFLICT, el horario ya está ocupado — propón otro disponible al cliente y vuelve a intentarlo.',
      parameters: {
        type:       'object',
        required:   ['service_id', 'date', 'time'],
        properties: {
          service_id: { type: 'string', description: 'UUID exacto del servicio del catálogo (sin prefijo REF#)' },
          date:       { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          time:       { type: 'string', description: 'Hora LOCAL acordada con el cliente en formato HH:mm 24h (ej: 15:00 para 3:00 PM). Convierte internamente si el cliente dijo "3 PM" → "15:00". NO conviertas a UTC.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name:        'reschedule_booking',
      description: 'Reagenda una cita existente a nueva fecha/hora. Llamar SOLO después de confirmación explícita del cliente.',
      parameters: {
        type:       'object',
        required:   ['appointment_id', 'new_date', 'new_time'],
        properties: {
          appointment_id: { type: 'string', description: 'UUID exacto de la cita activa a reagendar (sin prefijo REF#)' },
          new_date:       { type: 'string', description: 'Nueva fecha en formato YYYY-MM-DD' },
          new_time:       { type: 'string', description: 'Nueva hora LOCAL en formato HH:mm 24h (ej: 15:00 para 3:00 PM). Convierte internamente si el cliente dijo "3 PM" → "15:00".' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name:        'cancel_booking',
      description: 'Cancela una cita existente. Llamar SOLO después de confirmación explícita del cliente.',
      parameters: {
        type:       'object',
        required:   ['appointment_id'],
        properties: {
          appointment_id: { type: 'string', description: 'UUID exacto de la cita activa a cancelar (sin prefijo REF#)' },
        },
        additionalProperties: false,
      },
    },
  },
]

// ── Argument Validators ───────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function sanitizeUUID(id: string | undefined): string {
  if (!id) return ''
  return id.replace(/^(?:REF#?|ID#?)\s*/i, '').trim()
}

function sanitizeTime(time: string | undefined): string {
  if (!time) return ''
  let t = time.trim()
  
  // Si dice "5 PM" sin minutos, lo convertimos a "5:00 PM"
  if (/^(\d{1,2})\s*(AM|PM)$/i.test(t)) {
    t = t.replace(/^(\d{1,2})\s*(AM|PM)$/i, '$1:00 $2')
  }

  const m = t.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i)
  if (!m) return t
  let h = parseInt(m[1]!, 10)
  const isPM = m[3]?.toUpperCase() === 'PM'
  const isAM = m[3]?.toUpperCase() === 'AM'
  if (isPM && h < 12) h += 12
  if (isAM && h === 12) h = 0
  return `${h.toString().padStart(2, '0')}:${m[2]}`
}

function sanitizeDate(date: string | undefined): string {
  if (!date) return ''
  let t = date.trim()
  
  // occasionally LLM might pass DD-MM-YYYY or DD/MM/YYYY
  const dm = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dm) return `${dm[3]}-${dm[2]?.padStart(2, '0')}-${dm[1]?.padStart(2, '0')}`

  // Si dice "28-04" sin año, le ponemos el año actual
  const noYear = t.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (noYear) return `${new Date().getFullYear()}-${noYear[2]?.padStart(2, '0')}-${noYear[1]?.padStart(2, '0')}`

  return t
}

function isValidUUID(id: string): boolean   { return UUID_REGEX.test(id) }
function isValidDate(date: string): boolean  { return DATE_REGEX.test(date) }
function isValidTime(time: string): boolean  { return TIME_REGEX.test(time) }

/**
 * Checks whether a stored `clients.phone` (which may be formatted: "+58 414 7531158",
 * "04147531158", etc.) matches the raw WhatsApp sender (bare digits from Meta).
 * Strips all non-digits from both sides, and handles the Venezuelan leading-zero
 * variant (58 0424xxx vs 58 424xxx) — mirror of fn_find_client_by_phone logic.
 */
function phoneMatches(storedPhone: string, sender: string): boolean {
  const a = storedPhone.replace(/\D/g, '')
  const b = sender.replace(/\D/g, '')
  if (!a || !b) return false
  if (a === b) return true
  // Leading-zero variant after country code (e.g. 58 0424 vs 58 424)
  if (a.length >= 3 && b.length >= 3) {
    const aStripped = `${a.slice(0, 2)}${a.slice(3)}`
    const bStripped = `${b.slice(0, 2)}${b.slice(3)}`
    if (a.charAt(2) === '0' && aStripped === b) return true
    if (b.charAt(2) === '0' && bStripped === a) return true
  }
  return false
}

// ── Tool Executor ─────────────────────────────────────────────────────────────

export async function executeToolCall(
  toolCall:     ToolCall,
  context:      BusinessRagContext,
  sender:       string,
  customerName: string,
): Promise<string> {
  const { business, services, client } = context
  const name = toolCall.function.name

  let args: Record<string, string>
  try {
    args = JSON.parse(toolCall.function.arguments)
  } catch {
    return JSON.stringify({ success: false, error: 'INVALID_ARGUMENTS: could not parse tool arguments' })
  }

  addBreadcrumb(`Tool call: ${name}`, 'agent', 'info', { args })

  // ── confirm_booking ──────────────────────────────────────────────────────────
  if (name === 'confirm_booking') {
    let { service_id, date, time } = args
    service_id = sanitizeUUID(service_id)
    date = sanitizeDate(date)
    time = sanitizeTime(time)

    // Fallback: Si el modelo 8B escribe el nombre del servicio en vez del UUID ("Tarjeta" en vez de "1234-...")
    if (!isValidUUID(service_id)) {
      const match = services.find(s => s.name.toLowerCase().includes(service_id.toLowerCase()))
      if (match) service_id = match.id
    }

    if (!isValidUUID(service_id)) return JSON.stringify({ success: false, error: 'INVALID_ARGS: service_id must be a valid UUID' })
    if (!isValidDate(date))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: date must be YYYY-MM-DD' })
    if (!isValidTime(time))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: time must be HH:mm' })

    // Booking rate limit: check BEFORE attempting DB insert (read-only since fn now counts active appointments)
    // Limit = 5 active bookings per 24h per client. After cancelling, they can rebook.
    const bookingAllowed = await checkBookingRateLimit(sender, business.id)
    if (!bookingAllowed) {
      return JSON.stringify({ success: false, error: 'BOOKING_RATE_LIMIT: límite de citas nuevas por hoy alcanzado' })
    }

    const result = await createAppointment(business.id, {
      client_phone: sender,
      client_name:  client?.name ?? customerName,
      service_id,
      date,
      time,
      timezone:     business.timezone,
    })

    if (!result.success) {
      return JSON.stringify({ success: false, error: result.error ?? 'SLOT_CONFLICT' })
    }

    // Fire-and-forget: notificaciones al owner (pipeline unificado con event_id)
    const svcName = services.find(s => s.id === service_id)?.name ?? 'Servicio'
    // `time` es HH:mm (24h) — consistente con el path web (RealToolExecutor).
    // `formattedTime` solo es para el texto de respuesta al cliente, NO para el evento.
    const formattedTime = formatLocalTime(time)
    emitCreatedEvent(business, client?.name ?? customerName, svcName, date, time, result.appointment_id ?? '')


    addBreadcrumb('Appointment created', 'agent', 'info', { appointment_id: result.appointment_id })
    return JSON.stringify({ success: true, appointment_id: result.appointment_id, date, time, service_name: svcName })
  }

  // ── reschedule_booking ───────────────────────────────────────────────────────
  if (name === 'reschedule_booking') {
    let { appointment_id, new_date, new_time } = args
    appointment_id = sanitizeUUID(appointment_id)
    new_date = sanitizeDate(new_date)
    new_time = sanitizeTime(new_time)

    if (!isValidUUID(appointment_id)) return JSON.stringify({ success: false, error: 'INVALID_ARGS: appointment_id must be a valid UUID' })
    if (!isValidDate(new_date))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: new_date must be YYYY-MM-DD' })
    if (!isValidTime(new_time))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: new_time must be HH:mm' })

    const aptDetails = await getAppointmentDetails(appointment_id)

    // Ownership validation: ensure appointment belongs to this business and client
    if (!aptDetails || aptDetails.business_id !== business.id) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this business' })
    }
    const aptClientPhone = (aptDetails.clients as { phone?: string })?.phone ?? null
    if (aptClientPhone && !phoneMatches(aptClientPhone, sender)) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this client' })
    }

    const newStartAt = localTimeToUTC(new_date, new_time, business.timezone)
    const rescheduleResult = await rescheduleAppointment(appointment_id, newStartAt, business.id)
    if (!rescheduleResult.success) {
      return JSON.stringify({ success: false, error: rescheduleResult.error ?? 'RESCHEDULE_FAILED' })
    }

    const svcName    = aptDetails.services?.name ?? 'Servicio'
    const clientName = aptDetails.clients?.name ?? customerName

    emitRescheduledEvent(business, clientName, svcName, appointment_id, new_date, new_time)

    addBreadcrumb('Appointment rescheduled', 'agent', 'info', { appointment_id })
    return JSON.stringify({ success: true, new_date, new_time, service_name: svcName })
  }

  // ── cancel_booking ───────────────────────────────────────────────────────────
  if (name === 'cancel_booking') {
    const { appointment_id } = args

    if (!isValidUUID(appointment_id)) return JSON.stringify({ success: false, error: 'INVALID_ARGS: appointment_id must be a valid UUID' })

    const aptDetails = await getAppointmentDetails(appointment_id)

    // Ownership validation: ensure appointment belongs to this business and client
    if (!aptDetails || aptDetails.business_id !== business.id) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this business' })
    }
    const aptClientPhone = (aptDetails.clients as { phone?: string })?.phone ?? null
    if (aptClientPhone && !phoneMatches(aptClientPhone, sender)) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this client' })
    }

    await cancelAppointmentById(appointment_id, business.id)

    const svcName    = aptDetails.services?.name ?? 'Servicio'
    const clientName = aptDetails.clients?.name ?? customerName

    emitCancelledEvent(business, clientName, svcName, appointment_id, aptDetails.start_at)

    addBreadcrumb('Appointment cancelled', 'agent', 'info', { appointment_id })
    // Include old date/time (local tz) so downstream client-confirmation text has all data.
    const { date: oldDate, time: oldTime } = utcToLocalParts(aptDetails.start_at, business.timezone)
    return JSON.stringify({ success: true, service_name: svcName, date: oldDate, time: oldTime })
  }

  return JSON.stringify({ success: false, error: `UNKNOWN_TOOL: ${name}` })
}
