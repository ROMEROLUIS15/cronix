/**
 * Tool Executor — WhatsApp AI Agent
 *
 * Tool definitions (JSON Schema for the LLM) and a thin executor that
 * delegates DB operations to WhatsAppBookingAdapter (shared) while keeping
 * WhatsApp-specific: rate limiting, constitutional guard, notifications.
 */

import type { BusinessRagContext } from "./types.ts"
import { addBreadcrumb, captureException } from "../_shared/sentry.ts"
import { checkBookingRateLimit } from "./guards.ts"
import { WhatsAppBookingAdapter } from "../_shared/booking-adapter.ts"
import type { ToolCall } from "./groq-client.ts"
import {
  emitCreatedEvent,
  emitRescheduledEvent,
  emitCancelledEvent,
} from "./notifications.ts"
import type { ReviewedToolName } from "../_shared/supervisor/contracts.ts"
import { buildSuccessTemplateData } from "./success-data.ts"
import { invalidateDashboardCache } from "../_shared/cache-invalidation.ts"

export type WriteGuard = (
  toolName: ReviewedToolName,
  args:     Readonly<Record<string, unknown>>,
) => Promise<{ blocked: true; reason: string } | null>

// ── Adapter singleton (lazy) ─────────────────────────────────────────────────

let _adapter: WhatsAppBookingAdapter | null = null
function getAdapter(): WhatsAppBookingAdapter {
  if (!_adapter) {
    _adapter = new WhatsAppBookingAdapter(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
  }
  return _adapter
}

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

// ── Tool Executor ─────────────────────────────────────────────────────────────

export async function executeToolCall(
  toolCall:     ToolCall,
  context:      BusinessRagContext,
  sender:       string,
  customerName: string,
  guard?:       WriteGuard,
): Promise<string> {
  const { business, services, client } = context
  // Normalize the tool name: native tool-calling returns it lowercase, but a recovered
  // <function=…> leak can carry mixed case — the adapter + the `name === '…'` notification
  // checks below all use lowercase literals, so fold it once here.
  const name = toolCall.function.name.toLowerCase()

  let args: Record<string, string>
  try {
    args = JSON.parse(toolCall.function.arguments)
  } catch {
    return JSON.stringify({ success: false, error: 'INVALID_ARGUMENTS: could not parse tool arguments' })
  }

  addBreadcrumb(`Tool call: ${name}`, 'agent', 'info', { args })

  // Rate limit + guard — WhatsApp-specific, checked BEFORE delegating to adapter
  if (name === 'confirm_booking') {
    const bookingAllowed = await checkBookingRateLimit(sender, business.id)
    if (!bookingAllowed) {
      return JSON.stringify({ success: false, error: 'BOOKING_RATE_LIMIT: límite de citas nuevas por hoy alcanzado' })
    }
  }

  const guardToolName = (
    name === 'confirm_booking'   ? 'book_appointment'
    : name === 'reschedule_booking' ? 'reschedule_appointment'
    : name === 'cancel_booking'     ? 'cancel_appointment'
    : null
  ) as ReviewedToolName | null

  if (guard && guardToolName) {
    const denial = await guard(guardToolName, { ...args, sender })
    if (denial) return JSON.stringify({ success: false, error: `UNAUTHORIZED: ${denial.reason}` })
  }

  // Delegate DB operation to shared booking adapter
  const adapterResult = await getAdapter().execute({
    toolName: name,
    rawArgs: args,
    businessId: business.id,
    timezone: business.timezone,
    senderPhone: sender,
    services: context.services.map(s => ({ id: s.id, name: s.name, duration_min: s.duration_min, price: s.price })),
    activeAppts: context.activeAppointments.map(a => ({ id: a.id, service_name: a.service_name, start_at: a.start_at })),
    customerName,  // real WhatsApp profile name → invariante N1 (no placeholder)
  })

  if (!adapterResult.success) {
    return JSON.stringify({ success: false, error: adapterResult.error })
  }

  // Invariante O1 / AC-CACHE: toda escritura WA exitosa invalida la caché del
  // dashboard (clients/appointments/dashboard) para que la cita aparezca en el
  // calendario y la campana sin esperar la expiración del TTL. Fire-and-forget.
  void invalidateDashboardCache(business.id)

  // WhatsApp-specific notifications.
  // reschedule_booking / cancel_booking carry no service_id, so recover the
  // service name — and the original start_at the cancelled-event needs to render
  // a local date — from the client's active appointments (snapshot taken before
  // the write, so it still holds the pre-cancellation values).
  const apptIdArg  = (args['appointment_id'] ?? '').replace(/^(?:REF#?|ID#?)\s*/i, '').trim()
  const activeAppt = apptIdArg ? context.activeAppointments.find(a => a.id === apptIdArg) : undefined

  const svcName = services.find(s => s.id === args['service_id'])?.name
    ?? activeAppt?.service_name
    ?? (adapterResult as any).service_name
    ?? 'Servicio'

  // Notificación al DUEÑO (DB → campana → WhatsApp → push), invariantes O1/O2.
  // El acuse al CLIENTE es ÚNICO (invariante C1): lo provee la respuesta
  // conversacional del agente (renderBookingSuccessTemplate). NO se envía aquí un
  // segundo mensaje al cliente — eso causaba la doble confirmación (defecto D1).
  if (name === 'confirm_booking') {
    emitCreatedEvent(business, client?.name ?? customerName, svcName, args['date'] ?? '', args['time'] ?? '', adapterResult.appointmentId ?? '')
  } else if (name === 'reschedule_booking') {
    emitRescheduledEvent(business, client?.name ?? customerName, svcName, args['appointment_id'] ?? '', args['new_date'] ?? '', args['new_time'] ?? '')
  } else if (name === 'cancel_booking') {
    emitCancelledEvent(business, client?.name ?? customerName, svcName, args['appointment_id'] ?? '', activeAppt?.start_at ?? '')
  }

  // Enrich the tool result with the fields renderBookingSuccessTemplate reads.
  // The adapter returns camelCase (serviceName/date/time); the final-pass template
  // (final-response.ts → prompt-builder.ts) reads snake_case, and reschedule reads
  // new_date/new_time. Without this mapping the success message renders blank
  // (e.g. "Tu cita para ** quedó agendada") because the fields are absent.
  const successData = buildSuccessTemplateData(name, adapterResult)

  addBreadcrumb(`Tool ${name} succeeded`, 'agent', 'info', { appointmentId: adapterResult.appointmentId })
  // success:true is authoritative and goes LAST so neither spread can overwrite it
  // (this is the success branch); the spreads only add the template/adapter fields.
  return JSON.stringify({ ...adapterResult, ...successData, success: true })
}
