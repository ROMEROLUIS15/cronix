/**
 * AI Agent for Appointment Scheduling — ReAct Loop Architecture
 *
 * Implements a multi-step reasoning loop (ReAct pattern) using Native JSON Tool Calling.
 * Replaces the previous one-shot Action Tags + Regex approach.
 *
 * Architecture:
 *  - Small model (llama-3.1-8b-instant) handles the decision/tool-calling loop (MAX_STEPS=3)
 *  - Large model (llama-3.3-70b-versatile) generates the final empathetic response
 *  - If DB rejects a booking (SLOT_CONFLICT), the LLM sees the error and self-corrects
 *
 * Exposes:
 *  - runAgentLoop    → ReAct loop: reasons, calls tools, returns final text
 *  - transcribeAudio → Groq Whisper STT (unchanged)
 *
 * Does NOT expose:
 *  - Raw API key handling (encapsulated)
 *  - Prompt engineering internals
 *  - DB mutation logic (encapsulated in executeToolCall)
 */

import type { BusinessRagContext } from "./types.ts"
import {
  addBreadcrumb,
  captureException,
}                                from "../_shared/sentry.ts"
import {
  checkCircuitBreaker,
  reportServiceFailure,
  reportServiceSuccess,
  checkBookingRateLimit,
  createAppointment,
  rescheduleAppointment,
  cancelAppointmentById,
  getAppointmentDetails,
  localTimeToUTC,
  createInternalNotification,
}                                from "./database.ts"
import { sendWhatsAppMessage }   from "./whatsapp.ts"

// ── LLM Provider Configuration ────────────────────────────────────────────────

const SMALL_MODEL   = 'llama-3.1-8b-instant'    // decision loop + tool calling
const LARGE_MODEL   = 'llama-3.3-70b-versatile'  // final empathetic response
const WHISPER_MODEL = 'whisper-large-v3-turbo'
const MAX_STEPS     = 3

// Helicone gateway: proxies Groq calls for latency, cost, and threat monitoring.
// @ts-ignore — Deno runtime global
const HELICONE_API_KEY = Deno.env.get('HELICONE_API_KEY') ?? ''
const GROQ_BASE        = HELICONE_API_KEY
  ? 'https://groq.helicone.ai/openai/v1'
  : 'https://api.groq.com/openai/v1'

const LLM_API_URL     = `${GROQ_BASE}/chat/completions`
const WHISPER_API_URL = `${GROQ_BASE}/audio/transcriptions`

function heliconeHeaders(properties: Record<string, string> = {}, cache = false): Record<string, string> {
  if (!HELICONE_API_KEY) return {}
  const headers: Record<string, string> = {
    'Helicone-Auth':            `Bearer ${HELICONE_API_KEY}`,
    'Helicone-Property-Source': 'whatsapp-webhook',
  }
  if (cache) {
    headers['Helicone-Cache-Enabled'] = 'true'
  }
  for (const [key, value] of Object.entries(properties)) {
    headers[`Helicone-Property-${key}`] = value
  }
  return headers
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCallFunction {
  name:      'confirm_booking' | 'reschedule_booking' | 'cancel_booking'
  arguments: string // JSON stringified
}

interface ToolCall {
  id:       string
  type:     'function'
  function: ToolCallFunction
}

interface AgentMessage {
  role:           'system' | 'user' | 'assistant' | 'tool'
  content:        string | null
  tool_calls?:    ToolCall[]
  tool_call_id?:  string
  name?:          string
}

interface LlmResponse {
  choices?: Array<{
    message?: {
      content?:    string | null
      tool_calls?: ToolCall[]
    }
    finish_reason?: string
  }>
  usage?: { total_tokens: number }
  error?: { message?: string; type?: string; code?: string }
}

/**
 * Thrown when the LLM provider responds with HTTP 429 (rate limit exceeded).
 */
export class LlmRateLimitError extends Error {
  readonly retryAfterSecs: number

  constructor(retryAfterSecs: number) {
    super(`LLM rate limit exceeded — retry after ${retryAfterSecs}s`)
    this.name           = 'LlmRateLimitError'
    this.retryAfterSecs = retryAfterSecs
  }
}

/**
 * Thrown when the circuit breaker is OPEN (service is down).
 */
export class CircuitBreakerError extends Error {
  constructor(serviceName: string) {
    super(`Service ${serviceName} is currently unavailable (Circuit OPEN)`)
    this.name = 'CircuitBreakerError'
  }
}

// ── Tool Definitions ──────────────────────────────────────────────────────────

const BOOKING_TOOLS = [
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
          time:       { type: 'string', description: 'Hora LOCAL acordada con el cliente en formato HH:mm (24h). NO conviertas a UTC.' },
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
          new_time:       { type: 'string', description: 'Nueva hora LOCAL en formato HH:mm (24h)' },
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

// ── Private: Unified LLM Caller ───────────────────────────────────────────────

async function callLlm(
  model:         string,
  messages:      AgentMessage[],
  tools:         unknown[],
  heliconeProps: Record<string, string> = {},
  enableCache    = false,
): Promise<{ response: LlmResponse; tokens: number }> {
  // @ts-ignore — Deno runtime global
  const apiKey = Deno.env.get('LLM_API_KEY') ?? Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('LLM_API_KEY no configurada')

  const serviceName = 'GROQ_LLM'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: tools.length > 0 ? 0.0 : 0.2,
    max_tokens:  tools.length > 0 ? 512  : 500,
  }
  if (tools.length > 0) {
    payload.tools                = tools
    payload.tool_choice          = 'auto'
    payload.parallel_tool_calls  = false  // prevent duplicate bookings from parallel calls
  }

  let res: Response
  try {
    res = await fetch(LLM_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        ...heliconeHeaders(heliconeProps, enableCache),
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  const data: LlmResponse = await res.json()

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
      throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
    }
    if (res.status >= 500) await reportServiceFailure(serviceName)
    throw new Error(`LLM API Error: ${JSON.stringify(data.error ?? data)}`)
  }

  await reportServiceSuccess(serviceName)

  return {
    response: data,
    tokens:   data.usage?.total_tokens ?? 0,
  }
}

// ── Private: Minimal System Prompt (for 8B loop model) ────────────────────────

function buildMinimalSystemPrompt(context: BusinessRagContext, customerName: string): string {
  const { business, services, client, activeAppointments, bookedSlots } = context
  const { settings, timezone } = business

  const now            = new Date()
  const currentYear    = now.toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }).slice(0, 4)
  const currentDateISO = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const currentTime    = now.toLocaleString('es-ES', { timeZone: timezone })
  const hours          = settings.working_hours
    ? JSON.stringify(settings.working_hours, null, 2)
    : 'No especificado'

  let prompt = `Eres el asistente de agendamiento de "${business.name}". Tu función es agendar, reagendar o cancelar citas.

FECHA ACTUAL: ${currentDateISO} (año ${currentYear}). Hora actual: ${currentTime}. Zona horaria: ${timezone}.
Todas las fechas que uses en los tools DEBEN tener el año ${currentYear}.

AISLAMIENTO: Solo gestionas citas de "${business.name}". No respondas preguntas fuera de agendamiento.
`

  // Client context
  prompt += `\n--- CLIENTE ---\n`
  prompt += `WhatsApp: ${customerName}\n`
  prompt += client
    ? `Estado: Cliente recurrente registrado como "${client.name}".\n`
    : `Estado: Cliente nuevo.\n`

  // Active appointments (with IDs for tools)
  if (activeAppointments.length > 0) {
    prompt += `\n--- CITAS ACTIVAS ---\n`
    prompt += `Usa los REF# SOLO dentro de los argumentos del tool, NUNCA los menciones al cliente.\n`
    for (const apt of activeAppointments) {
      const dt      = new Date(apt.start_at)
      const dateStr = dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone })
      const timeStr = dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
      prompt += `• REF#${apt.id} | ${apt.service_name} — ${dateStr} a las ${timeStr} (${apt.status})\n`
    }
  }

  // Services catalog (with IDs for tools)
  prompt += `\n--- CATÁLOGO DE SERVICIOS ---\n`
  prompt += `Usa los REF# SOLO dentro de los argumentos del tool, NUNCA los menciones al cliente.\n`
  if (services.length > 0) {
    for (const svc of services) {
      prompt += `• ${svc.name} — ${svc.duration_min} min — $${svc.price} | REF#${svc.id}\n`
    }
  } else {
    prompt += `(Sin servicios configurados)\n`
  }

  // Schedule & rules
  prompt += `\n--- HORARIO Y REGLAS ---\n`
  prompt += `Horario de atención: ${hours}\n`
  if (settings.ai_rules) prompt += `Reglas: ${settings.ai_rules}\n`

  // Booked slots — capped at 50 to prevent token bloat on busy businesses
  const cappedSlots = (bookedSlots ?? []).slice(0, 50)
  if (cappedSlots.length > 0) {
    prompt += `\n--- HORARIOS YA OCUPADOS (PRÓXIMOS 14 DÍAS) ---\n`
    prompt += `REGLA CRÍTICA: NUNCA propongas ni confirmes un horario de esta lista.\n`
    for (const slot of cappedSlots) {
      prompt += `• OCUPADO: ${slot.start_at} hasta ${slot.end_at}\n`
    }
  }

  // ReAct rules
  prompt += `
--- REGLAS DE LOS TOOLS (OBLIGATORIO) ---

FLUJO DE DOS TURNOS (SIN EXCEPCIONES):
1. Primero propón la cita y pregunta confirmación → SIN llamar ningún tool
2. Solo cuando el cliente responda "sí", "dale", "ok" o equivalente en su SIGUIENTE mensaje → llamar el tool correspondiente
NUNCA llames un tool en el mismo turno donde haces una pregunta.

MANEJO DE ERRORES:
- Si confirm_booking retorna success=false con error SLOT_CONFLICT: ese horario ya está ocupado.
  INFORMA al cliente que no está disponible, SUGIERE horarios alternativos dentro del horario de atención,
  y ESPERA su confirmación antes de volver a llamar confirm_booking. NO reserves automáticamente otro horario.
- Si cancel_booking o reschedule_booking fallan, informa al cliente y pide que intente con otra cita.

IDENTIFICADORES:
- Pasa SOLO el UUID en los argumentos del tool. NUNCA incluyas el prefijo "REF#".
- ✅ CORRECTO: "service_id": "339afed4-cbc2-423b-9d8c-17a6f52fb642"
- ❌ INCORRECTO: "service_id": "REF#339afed4-cbc2-423b-9d8c-17a6f52fb642"
`

  return prompt
}

// ── Private: Argument Validators ─────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isValidUUID(id: string): boolean   { return UUID_REGEX.test(id) }
function isValidDate(date: string): boolean  { return DATE_REGEX.test(date) }
function isValidTime(time: string): boolean  { return TIME_REGEX.test(time) }

// ── Private: Tool Executor ─────────────────────────────────────────────────────

async function executeToolCall(
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
    const { service_id, date, time } = args

    if (!isValidUUID(service_id)) return JSON.stringify({ success: false, error: 'INVALID_ARGS: service_id must be a valid UUID' })
    if (!isValidDate(date))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: date must be YYYY-MM-DD' })
    if (!isValidTime(time))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: time must be HH:mm' })

    // Booking rate limit check
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

    // Fire-and-forget: notificaciones al owner
    const svcName = services.find(s => s.id === service_id)?.name ?? 'Servicio'
    const formattedTime = formatLocalTime(time)
    fireOwnerNotifications(business, client?.name ?? customerName, svcName, date, formattedTime, result.appointment_id ?? '')
      .catch(err => captureException(err, { stage: 'owner_notifications_confirm', business_id: business.id }))

    addBreadcrumb('Appointment created', 'agent', 'info', { appointment_id: result.appointment_id })
    return JSON.stringify({ success: true, appointment_id: result.appointment_id, date, time, service_name: svcName })
  }

  // ── reschedule_booking ───────────────────────────────────────────────────────
  if (name === 'reschedule_booking') {
    const { appointment_id, new_date, new_time } = args

    if (!isValidUUID(appointment_id)) return JSON.stringify({ success: false, error: 'INVALID_ARGS: appointment_id must be a valid UUID' })
    if (!isValidDate(new_date))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: new_date must be YYYY-MM-DD' })
    if (!isValidTime(new_time))       return JSON.stringify({ success: false, error: 'INVALID_ARGS: new_time must be HH:mm' })

    const aptDetails = await getAppointmentDetails(appointment_id)

    // Ownership validation: ensure appointment belongs to this business and client
    if (!aptDetails || aptDetails.business_id !== business.id) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this business' })
    }
    const aptClientPhone = (aptDetails.clients as { phone?: string })?.phone ?? null
    if (aptClientPhone && aptClientPhone !== sender) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this client' })
    }

    const newStartAt = localTimeToUTC(new_date, new_time, business.timezone)
    await rescheduleAppointment(appointment_id, newStartAt)

    if (aptDetails && business.phone) {
      const svcName    = aptDetails.services?.name ?? 'Servicio'
      const clientName = aptDetails.clients?.name ?? customerName

      const oldDateObj = new Date(aptDetails.start_at)
      const oldDateStr = new Intl.DateTimeFormat('es-ES', { timeZone: business.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(oldDateObj)
      const oldTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(oldDateObj).toLowerCase()
      const newTimeFormatted = formatLocalTime(new_time)

      const ownerPhone = business.phone.replace(/\D/g, '')
      const waNotif =
        `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
        `El cliente *${clientName}* ha *reagendado* su cita de *${svcName}*.\n\n` +
        `❌ Espacio liberado: *${oldDateStr}* a las *${oldTimeStr}*\n` +
        `✅ Nuevo espacio reservado: *${new_date}* a las *${newTimeFormatted}*\n\n` +
        `¡Tu agenda ha sido actualizada correctamente! 💪🚀`

      sendWhatsAppMessage(ownerPhone, waNotif)
        .catch(err => captureException(err, { stage: 'wa_notify_owner_reschedule', business_id: business.id }))

      createInternalNotification(
        business.id,
        'Cita Reagendada 🔄',
        `${clientName} movió su cita de ${svcName} al ${new_date} a las ${newTimeFormatted}`,
        'info',
        { appointment_id },
      ).catch(err => captureException(err, { stage: 'inapp_notification_reschedule', business_id: business.id }))
    }

    addBreadcrumb('Appointment rescheduled', 'agent', 'info', { appointment_id })
    return JSON.stringify({ success: true, new_date, new_time, service_name: aptDetails?.services?.name ?? 'Servicio' })
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
    if (aptClientPhone && aptClientPhone !== sender) {
      return JSON.stringify({ success: false, error: 'UNAUTHORIZED: appointment does not belong to this client' })
    }

    await cancelAppointmentById(appointment_id)

    if (aptDetails && business.phone) {
      const svcName    = aptDetails.services?.name ?? 'Servicio'
      const clientName = aptDetails.clients?.name ?? customerName

      const oldDateObj = new Date(aptDetails.start_at)
      const oldDateStr = new Intl.DateTimeFormat('es-ES', { timeZone: business.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(oldDateObj)
      const oldTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(oldDateObj).toLowerCase()

      const ownerPhone = business.phone.replace(/\D/g, '')
      const waNotif =
        `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
        `El cliente *${clientName}* ha *cancelado* su cita, por lo que tienes un nuevo espacio libre el día *${oldDateStr}* a las *${oldTimeStr}* para el servicio: *${svcName}*.\n\n` +
        `¡Sigo activo para atender y asignarle este nuevo espacio libre a otro cliente! 💪🚀`

      sendWhatsAppMessage(ownerPhone, waNotif)
        .catch(err => captureException(err, { stage: 'wa_notify_owner_cancel', business_id: business.id }))

      createInternalNotification(
        business.id,
        'Cita Cancelada ❌',
        `${clientName} canceló su cita de ${svcName} del ${oldDateStr}`,
        'warning',
        { appointment_id },
      ).catch(err => captureException(err, { stage: 'inapp_notification_cancel', business_id: business.id }))
    }

    addBreadcrumb('Appointment cancelled', 'agent', 'info', { appointment_id })
    return JSON.stringify({ success: true, service_name: aptDetails?.services?.name ?? 'Servicio' })
  }

  return JSON.stringify({ success: false, error: `UNKNOWN_TOOL: ${name}` })
}

// ── Private: Owner Notifications (confirm_booking) ────────────────────────────

async function fireOwnerNotifications(
  business:     BusinessRagContext['business'],
  clientName:   string,
  svcName:      string,
  date:         string,
  formattedTime: string,
  appointmentId: string,
): Promise<void> {
  // @ts-ignore — Deno runtime global
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const cronSecret  = Deno.env.get('CRON_SECRET')  ?? ''

  // Channel 0: In-App Notification (Dashboard Bell)
  createInternalNotification(
    business.id,
    'Nueva Cita Agendada 📅',
    `${clientName} reservó ${svcName} para el ${date} a las ${formattedTime}`,
    'success',
    { appointment_id: appointmentId },
  ).catch(err => captureException(err, { stage: 'inapp_notification_confirm', business_id: business.id }))

  // Channel 1: Web Push notification (PWA)
  fetch(`${supabaseUrl}/functions/v1/push-notify`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-internal-secret': cronSecret,
    },
    body: JSON.stringify({
      business_id: business.id,
      title:       '¡Nueva Reserva! 📅',
      body:        `${clientName} · ${svcName} — ${date} ${formattedTime} ✅`,
      url:         '/dashboard',
    }),
  }).catch(err => captureException(err, { stage: 'push_new_booking', business_id: business.id }))

  // Channel 2: WhatsApp message to business owner
  if (business.phone) {
    const ownerPhone = business.phone.replace(/\D/g, '')
    const waNotif =
      `¡Hola equipo de *${business.name}*! 👋🤖\n\n` +
      `Ha sido agendada una cita para *${clientName}* el día *${date}* a las *${formattedTime}*\n` +
      `Servicio: *${svcName}*\n\n` +
      `¡Sigo trabajando a toda máquina para mantener tu agenda llena! 💪🚀`

    sendWhatsAppMessage(ownerPhone, waNotif)
      .catch(err => captureException(err, { stage: 'wa_notify_owner_confirm', business_id: business.id }))
  }
}

// ── Private: Time Formatter ───────────────────────────────────────────────────

function formatLocalTime(time: string): string {
  const [h, m]  = time.split(':')
  let hour      = parseInt(h, 10)
  const ampm    = hour >= 12 ? 'pm' : 'am'
  hour          = hour % 12
  hour          = hour ? hour : 12
  return `${hour}:${m} ${ampm}`
}

// ── Private: Booking Success Template Renderer ────────────────────────────────

function renderBookingSuccessTemplate(
  toolName: string,
  data:     Record<string, string>,
  timezone: string,
): string {
  switch (toolName) {
    case 'confirm_booking': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !/^\d{2}:\d{2}$/.test(data.time)) {
        return `✅ ¡Listo! Tu cita para *${data.service_name}* quedó agendada. ¿En qué más puedo ayudarte?`
      }
      const [cy, cm, cd] = data.date.split('-').map(Number)
      const dateObj = new Date(Date.UTC(cy, cm - 1, cd))
      const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(data.time)
      return `✅ ¡Listo! Tu cita para *${data.service_name}* quedó agendada para el ${dateStr} a las ${timeStr}. ¿En qué más puedo ayudarte?`
    }
    case 'reschedule_booking': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.new_date) || !/^\d{2}:\d{2}$/.test(data.new_time)) {
        return `✅ ¡Cita reagendada! Te esperamos en tu nuevo horario para *${data.service_name}*. ¿Necesitas algo más?`
      }
      const [ry, rm, rd] = data.new_date.split('-').map(Number)
      const dateObj = new Date(Date.UTC(ry, rm - 1, rd))
      const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(data.new_time)
      return `✅ ¡Cita reagendada! Ahora te esperamos el ${dateStr} a las ${timeStr} para *${data.service_name}*. ¿Necesitas algo más?`
    }
    case 'cancel_booking':
      return `✅ Tu cita de *${data.service_name}* ha sido cancelada. Cuando quieras agendar de nuevo, aquí estamos. 😊`
    default:
      return '✅ Acción completada.'
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the ReAct agent loop for a WhatsApp message.
 *
 * Inner loop (SMALL_MODEL): decides whether to call a booking tool, executes it,
 * feeds the DB result back to the LLM, and retries if needed (up to MAX_STEPS).
 *
 * Final pass (LARGE_MODEL): generates an empathetic, on-brand response for the customer.
 *
 * @param userText     - Sanitized message text from the customer
 * @param context      - Full BusinessRagContext (services, history, booked slots, etc.)
 * @param customerName - Display name from WhatsApp
 * @param sender       - WhatsApp phone number (used for booking payload)
 */
export async function runAgentLoop(
  userText:     string,
  context:      BusinessRagContext,
  customerName: string,
  sender:       string,
): Promise<{ text: string; tokens: number; toolCallsTrace: unknown[] }> {
  const { business } = context

  // Cap history at 8 messages (~4 turns) to prevent unbounded token growth
  const cappedHistory = context.history.slice(-8)

  // Build initial messages array
  const messages: AgentMessage[] = [
    { role: 'system', content: buildMinimalSystemPrompt(context, customerName) },
    // Inject conversation history (convert 'model' role to 'assistant')
    ...cappedHistory.map(h => ({
      role:    (h.role === 'model' ? 'assistant' : h.role) as AgentMessage['role'],
      content: h.text,
    })),
    { role: 'user', content: userText },
  ]

  let totalTokens:    number    = 0
  let step:           number    = 0
  let actionPerformed = false
  let loopText:       string    = ''
  const toolCallsTrace: unknown[] = []

  // Deduplication guard: blocks the LLM from calling the same tool with identical
  // arguments twice in a single turn, which would create duplicate appointments.
  const executedToolFingerprints = new Set<string>()

  // ── ReAct Loop (SMALL_MODEL) ──────────────────────────────────────────────
  while (step < MAX_STEPS) {
    step++

    addBreadcrumb(`ReAct loop step ${step}/${MAX_STEPS}`, 'agent', 'info', {
      model:    SMALL_MODEL,
      business: business.name,
    })

    const { response, tokens } = await callLlm(
      SMALL_MODEL,
      messages,
      BOOKING_TOOLS,
      { tenant: business.slug ?? 'unknown', customer: customerName, loop_step: String(step) },
    )
    totalTokens += tokens

    const assistantMsg = response.choices?.[0]?.message
    if (!assistantMsg) break

    // Add assistant turn to history (include tool_calls if present — required by API)
    messages.push({
      role:       'assistant',
      content:    assistantMsg.content ?? null,
      tool_calls: assistantMsg.tool_calls,
    })

    // No tool calls → LLM finished reasoning, capture text and break
    if (!assistantMsg.tool_calls?.length) {
      loopText = assistantMsg.content?.trim() ?? ''
      break
    }

    actionPerformed = true

    // Execute each tool call and feed results back
    for (const toolCall of assistantMsg.tool_calls) {
      const stepStart = Date.now()

      // Deduplication guard — same tool + same args in the same session = duplicate booking risk
      const fingerprint = `${toolCall.function.name}::${toolCall.function.arguments}`
      if (executedToolFingerprints.has(fingerprint)) {
        addBreadcrumb(`Duplicate tool call blocked: ${toolCall.function.name}`, 'agent', 'warning')
        messages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          name:         toolCall.function.name,
          content:      JSON.stringify({ success: false, error: 'DUPLICATE_CALL: esta acción ya fue ejecutada en este turno' }),
        })
        continue
      }
      executedToolFingerprints.add(fingerprint)

      let toolResult: string
      try {
        toolResult = await executeToolCall(toolCall, context, sender, customerName)
      } catch (err) {
        captureException(err, { stage: 'execute_tool_call', tool: toolCall.function.name })
        toolResult = JSON.stringify({ success: false, error: 'TOOL_EXECUTION_ERROR: error interno al ejecutar la acción' })
      }

      const parsedResult = (() => { try { return JSON.parse(toolResult) } catch { return toolResult } })()

      toolCallsTrace.push({
        step,
        tool:        toolCall.function.name,
        args:        (() => { try { return JSON.parse(toolCall.function.arguments) } catch { return toolCall.function.arguments } })(),
        result:      parsedResult,
        duration_ms: Date.now() - stepStart,
        success:     parsedResult?.success !== false,
      })

      messages.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        name:         toolCall.function.name,
        content:      toolResult,
      })
    }
  }

  // Detect loop exhaustion: hit MAX_STEPS while still executing tools (no clean break)
  const loopExhausted = step === MAX_STEPS && actionPerformed && !loopText

  if (loopExhausted) {
    captureException(
      new Error(`ReAct loop exhausted after ${MAX_STEPS} steps`),
      {
        stage:           'loop_exhausted',
        business_id:     business.id,
        steps_taken:     step,
        tools_attempted: (toolCallsTrace as Array<{ tool: string }>).map(t => t.tool).join(' → '),
      }
    )
    addBreadcrumb('Loop exhausted — escalating to LARGE_MODEL', 'agent', 'warning')
  }

  addBreadcrumb(`ReAct loop completed in ${step} step(s)`, 'agent', 'info', {
    total_tokens_so_far: totalTokens,
    action_performed:    actionPerformed,
    loop_exhausted:      loopExhausted,
  })

  // ── Final Pass (LARGE_MODEL): empathetic response ─────────────────────────
  // Only invoked when tools were executed (booking actions need on-brand confirmation)
  // or when the loop exited without generating any text (edge case: MAX_STEPS hit).
  // Pure conversational messages answered by the 8B skip this to save tokens.
  let finalText: string

  // Check if last tool call succeeded — if so, skip LARGE_MODEL entirely using template
  const lastToolMsg    = [...messages].reverse().find(m => m.role === 'tool')
  const lastToolParsed = lastToolMsg ? (() => { try { return JSON.parse(lastToolMsg.content ?? '') } catch { return null } })() : null
  const lastTrace      = toolCallsTrace[toolCallsTrace.length - 1] as { tool: string } | undefined

  if (actionPerformed && lastToolParsed?.success === true && !loopExhausted) {
    // Tool succeeded → use predefined template, skip LARGE_MODEL entirely
    finalText = renderBookingSuccessTemplate(
      lastTrace?.tool ?? '',
      lastToolParsed,
      business.timezone,
    )
    addBreadcrumb('Skipped LARGE_MODEL (success template used)', 'agent', 'info', { tool: lastTrace?.tool })
  } else if (actionPerformed || !loopText) {
    // Tool failed or loop exhausted → LARGE_MODEL explains the error naturally
    const personality = business.settings.ai_personality ?? 'amable, profesional y muy breve'

    messages.push({
      role:    'system',
      content: `El trabajo administrativo está completo. Ahora responde al cliente de forma cálida y natural en español.
Personalidad: ${personality}.
Sé conciso: máximo 2-3 oraciones.
NUNCA menciones UUIDs, REF#, IDs técnicos ni detalles de sistema al cliente.
Si se creó, reagendó o canceló una cita, confírmalo de forma celebratoria y breve.`,
    })

    const { response: finalRes, tokens: finalTokens } = await callLlm(
      LARGE_MODEL,
      messages,
      [],
      { tenant: business.slug ?? 'unknown', customer: customerName, loop_step: 'final' },
      true, // enableCache: empathetic responses are more cacheable
    )
    totalTokens += finalTokens

    finalText = finalRes.choices?.[0]?.message?.content?.trim() ?? ''
    if (!finalText) {
      if (loopExhausted) {
        // Loop exhausted AND final model returned nothing — return user-friendly message, no throw
        addBreadcrumb('Final pass empty after loop exhaustion — returning graceful fallback', 'agent', 'error')
        return {
          text:           'Intenté varias veces procesar tu solicitud pero no pude completarla. Por favor, intenta de nuevo en un momento o escríbenos directamente.',
          tokens:         totalTokens,
          toolCallsTrace,
        }
      }
      // Normal (non-exhaustion) final pass failure → throw so Sentry/DLQ capture it
      addBreadcrumb('LARGE_MODEL returned empty final response', 'agent', 'error')
      throw new Error('Respuesta vacía del LLM en el paso final')
    }
  } else {
    // 8B already produced a complete conversational response — use it directly
    finalText = loopText
    addBreadcrumb('Skipped LARGE_MODEL pass (conversational response from 8B)', 'agent', 'info')
  }

  addBreadcrumb('Agent loop finished', 'agent', 'info', { total_tokens: totalTokens, steps: step })

  return { text: finalText, tokens: totalTokens, toolCallsTrace }
}

// ── Public API: Audio Transcription ───────────────────────────────────────────

/**
 * Transcribes a voice note buffer to text using Groq Whisper.
 *
 * @param buffer   - Raw audio bytes (ogg/mp4/webm — whatever Meta sends)
 * @param mimeType - MIME type from Meta (e.g. 'audio/ogg; codecs=opus')
 */
export async function transcribeAudio(buffer: ArrayBuffer, mimeType: string): Promise<{ text: string | null; tokens: number }> {
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

  addBreadcrumb('Calling Whisper API', 'llm', 'info', { model: WHISPER_MODEL, mimeType })

  const serviceName = 'GROQ_WHISPER'
  if (!(await checkCircuitBreaker(serviceName))) {
    throw new CircuitBreakerError(serviceName)
  }

  let res: Response
  try {
    res = await fetch(WHISPER_API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...heliconeHeaders({ type: 'audio-transcription' }),
      },
      body: form,
    })
  } catch (err) {
    await reportServiceFailure(serviceName)
    throw err
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    throw new LlmRateLimitError(isNaN(retryAfter) ? 60 : retryAfter)
  }

  if (!res.ok) {
    if (res.status >= 500) await reportServiceFailure(serviceName)
    throw new Error(`Whisper API error: ${await res.text()}`)
  }

  await reportServiceSuccess(serviceName)

  const transcript     = (await res.text()).trim()
  const estimatedTokens = transcript ? 50 + transcript.split(/\s+/).length : 0

  return { text: transcript || null, tokens: estimatedTokens }
}
