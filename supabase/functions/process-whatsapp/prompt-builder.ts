/**
 * Prompt Builder — WhatsApp AI Agent
 *
 * Exposes:
 *  - buildMinimalSystemPrompt     → system prompt for the 8B ReAct loop
 *  - renderBookingSuccessTemplate → deterministic success messages (no LARGE_MODEL needed)
 *  - formatLocalTime              → HH:mm → "3:00 pm" AM/PM converter (shared utility)
 */

import type { BusinessRagContext } from "./types.ts"

// ── Shared Utility ────────────────────────────────────────────────────────────

/**
 * Converts internal HH:mm (24-hour) format to a human-readable AM/PM string.
 * Used in both system prompt and success templates.
 */
export function formatLocalTime(time: string): string {
  const [h, m] = time.split(':') as [string, string]
  let hour     = parseInt(h, 10)
  const ampm   = hour >= 12 ? 'pm' : 'am'
  hour         = hour % 12
  hour         = hour ? hour : 12
  return `${hour}:${m} ${ampm}`
}

// ── System Prompt Builder ─────────────────────────────────────────────────────

export function buildMinimalSystemPrompt(context: BusinessRagContext, customerName: string): string {
  const { business, services, client, activeAppointments, bookedSlots } = context
  const { settings, timezone } = business

  const now            = new Date()
  const currentYear    = now.toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }).slice(0, 4)
  const currentDateISO = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const currentTime    = now.toLocaleString('es-ES', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })
  const hours          = settings.working_hours
    ? JSON.stringify(settings.working_hours, null, 2)
    : 'No especificado'

  let prompt = `Eres el asistente de agendamiento de "${business.name}". Tu función es agendar, reagendar o cancelar citas.

FECHA ACTUAL: ${currentDateISO} (año ${currentYear}). Hora actual: ${currentTime}. Zona horaria: ${timezone}.
Todas las fechas que uses en los tools DEBEN tener el año ${currentYear}.

AISLAMIENTO: Solo gestionas citas de "${business.name}". No respondas preguntas fuera de agendamiento.
FORMATO DE HORAS: Siempre usa formato 12 horas con AM/PM al hablar con el cliente (ej: 3:00 PM, 10:30 AM). Nunca uses hora militar (15:00, 22:00).
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
      const timeStr = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
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

// ── Success Template Renderer ─────────────────────────────────────────────────

/**
 * Generates a deterministic booking confirmation message.
 * Called when a tool succeeds to avoid burning tokens on LARGE_MODEL for simple confirmations.
 */
export function renderBookingSuccessTemplate(
  toolName: string,
  data:     Record<string, string>,
  _timezone: string,
): string {
  switch (toolName) {
    case 'confirm_booking': {
      const date        = data['date']         ?? ''
      const time        = data['time']         ?? ''
      const serviceName = data['service_name'] ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return `✅ ¡Listo! Tu cita para *${serviceName}* quedó agendada. ¿En qué más puedo ayudarte?`
      }
      const [cy, cm, cd] = date.split('-').map(Number) as [number, number, number]
      const dateObj = new Date(Date.UTC(cy, cm - 1, cd))
      const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(time)
      return `✅ ¡Listo! Tu cita para *${serviceName}* quedó agendada para el ${dateStr} a las ${timeStr}. ¿En qué más puedo ayudarte?`
    }
    case 'reschedule_booking': {
      const newDate     = data['new_date']     ?? ''
      const newTime     = data['new_time']     ?? ''
      const serviceName = data['service_name'] ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^\d{2}:\d{2}$/.test(newTime)) {
        return `✅ ¡Cita reagendada! Te esperamos en tu nuevo horario para *${serviceName}*. ¿Necesitas algo más?`
      }
      const [ry, rm, rd] = newDate.split('-').map(Number) as [number, number, number]
      const dateObj = new Date(Date.UTC(ry, rm - 1, rd))
      const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(newTime)
      return `✅ ¡Cita reagendada! Ahora te esperamos el ${dateStr} a las ${timeStr} para *${serviceName}*. ¿Necesitas algo más?`
    }
    case 'cancel_booking':
      return `✅ Tu cita de *${data.service_name}* ha sido cancelada. Cuando quieras agendar de nuevo, aquí estamos. 😊`
    default:
      return '✅ Acción completada.'
  }
}
