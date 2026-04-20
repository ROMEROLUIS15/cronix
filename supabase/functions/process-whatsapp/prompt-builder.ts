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
  
  // Calculate tomorrow by adding 24 hours (safer for UTC basis than getDate() + 1 across timezones sometimes, 
  // but since we format with user timezone via Intl, it will yield the correct local tomorrow).
  const tomorrow       = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const currentYear    = now.toLocaleDateString('en-CA', { timeZone: timezone, year: 'numeric' }).slice(0, 4)
  const currentDateISO = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const tomorrowISO    = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone })
  
  const todayHuman     = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone })
  const tomorrowHuman  = tomorrow.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone })

  const currentTime    = now.toLocaleString('es-ES', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })
  const hours          = settings.working_hours
    ? JSON.stringify(settings.working_hours, null, 2)
    : 'No especificado'

  let prompt = `Eres el asistente de agendamiento de "${business.name}". Tu función es agendar, reagendar o cancelar citas.

CALENDARIO TEMPORAL Y ZONA HORARIA:
- HOY ES: ${todayHuman} (ISO: ${currentDateISO})
- MAÑANA ES: ${tomorrowHuman} (ISO: ${tomorrowISO})
Hora actual local: ${currentTime} (${timezone}).

AISLAMIENTO: Solo gestionas citas de "${business.name}". No respondas preguntas fuera de agendamiento.
FORMATO DE HORAS: Siempre usa formato 12 horas con AM/PM al hablar con el cliente (ej: 3:00 PM, 10:30 AM). Nunca uses hora militar (15:00, 22:00).
FECHAS — REGLA CRÍTICA: NUNCA menciones el día de la semana en tus respuestas (lunes, martes, etc.). Usa ÚNICAMENTE "el 20 de abril" o la fecha numérica, NUNCA "el lunes 20 de abril". Cuando llames a los tools, debes usar estrictamente el formato ISO YYYY-MM-DD. Si ya definiste una fecha en el turno anterior, MANTÉNLA, no la cambies arbitrariamente al día siguiente.
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
  prompt += `Resolución de servicios: Si el cliente pide un servicio que no está textualmente en el catálogo, busca el más similar por nombre. Si hay coincidencia parcial → pregunta: "¿Querías decir [nombre del servicio]?" Solo si NO hay ninguna coincidencia → responde: "No veo ese servicio. Los disponibles son: [lista de nombres]." NUNCA digas 'no tenemos ese servicio' o 'no existe' sin revisar TODO el catálogo.\n`

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

FLUJO ESTRICTO DE DOS TURNOS — OBLIGATORIO PARA LOS 3 TOOLS.
Regla maestra: JAMÁS llames un tool sin confirmación explícita del cliente en el turno inmediatamente anterior.

CITAS NUEVAS (confirm_booking):
1. Reúne servicio + fecha + hora. Si falta algo, pregunta.
2. Con los 3 datos, propón: "¿Confirmo tu cita de [servicio] para el [fecha] a las [hora]?"
3. ESPERA respuesta. Solo con "sí/dale/ok/confirma" del cliente → llama confirm_booking.

REAGENDAMIENTO (reschedule_booking):
1. Si NO tiene citas activas, infórmale y termina.
2. Si tiene VARIAS, pregunta CUÁL quiere reagendar.
3. PROHIBIDO reutilizar la fecha/hora actual o inventar fechas. Si el cliente no dio new_date y new_time explícitas, PREGUNTA: "¿Para qué fecha y hora quieres reagendarla?"
4. Con new_date y new_time del cliente, propón: "¿Reagendo tu cita de [servicio] al [nueva fecha] a las [nueva hora]?"
5. ESPERA respuesta. Solo con "sí/dale/ok/confirma" → llama reschedule_booking.

CANCELACIÓN (cancel_booking):
1. Si NO tiene citas activas, infórmale y termina.
2. Si tiene VARIAS, pregunta CUÁL.
3. Propón: "¿Confirmas que cancele tu cita de [servicio] del [fecha] a las [hora]?"
4. ESPERA respuesta. Solo con "sí/dale/ok/confirma" → llama cancel_booking.

EJECUCIÓN SILENCIOSA AL RECIBIR CONFIRMACIÓN:
- Llama el tool DIRECTAMENTE, SIN generar texto previo. El sistema responde con plantilla automática.
- NO respondas "Perfecto, voy a confirmar..." — solo llama el tool.

PROHIBICIONES ABSOLUTAS:
- JAMÁS llames un tool con datos que el cliente no dijo explícitamente.
- JAMÁS saltes el paso "¿Confirmo...?" — los 3 tools lo requieren.

MANEJO DE ERRORES:
- Si confirm_booking retorna success=false con error SLOT_CONFLICT: ese horario ya está ocupado.
  INFORMA al cliente que no está disponible, SUGIERE horarios alternativos dentro del horario de atención,
  y ESPERA su confirmación antes de volver a llamar confirm_booking. NO reserves automáticamente otro horario.

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

// ── Client Formal Confirmation (additional message) ──────────────────────────

/**
 * Builds a formal, structured confirmation message addressed to the client by name.
 * Sent AFTER the conversational success template as a second WhatsApp message.
 * Returns null if the tool/data combination doesn't warrant a formal block.
 */
export function renderClientConfirmation(
  toolName:   string,
  data:       Record<string, string>,
  clientName: string,
): string | null {
  const name = (clientName || '').trim() || 'cliente'

  switch (toolName) {
    case 'confirm_booking': {
      const date        = data['date']         ?? ''
      const time        = data['time']         ?? ''
      const serviceName = data['service_name'] ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !serviceName) return null
      const [y, m, d] = date.split('-').map(Number) as [number, number, number]
      const dateStr = new Date(Date.UTC(y, m - 1, d))
        .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(time)
      return `✨ ¡Perfecto, ${name}! Tu cita ha sido agendada:\n\n📅 *Fecha:* ${dateStr}\n⏰ *Hora:* ${timeStr}\n💼 *Servicio:* ${serviceName}\n\n¡Te esperamos! 💪`
    }
    case 'reschedule_booking': {
      const newDate     = data['new_date']     ?? ''
      const newTime     = data['new_time']     ?? ''
      const serviceName = data['service_name'] ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^\d{2}:\d{2}$/.test(newTime) || !serviceName) return null
      const [y, m, d] = newDate.split('-').map(Number) as [number, number, number]
      const dateStr = new Date(Date.UTC(y, m - 1, d))
        .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(newTime)
      return `🔄 ¡Listo, ${name}! Tu cita ha sido reagendada:\n\n📅 *Nueva fecha:* ${dateStr}\n⏰ *Nueva hora:* ${timeStr}\n💼 *Servicio:* ${serviceName}\n\n¡Nos vemos pronto! 🚀`
    }
    case 'cancel_booking': {
      const date        = data['date']         ?? ''
      const time        = data['time']         ?? ''
      const serviceName = data['service_name'] ?? ''
      if (!serviceName) return null
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return `❌ Entendido, ${name}. Tu cita de *${serviceName}* ha sido cancelada. Cuando quieras agendar de nuevo, aquí estamos. 😊`
      }
      const [y, m, d] = date.split('-').map(Number) as [number, number, number]
      const dateStr = new Date(Date.UTC(y, m - 1, d))
        .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = formatLocalTime(time)
      return `❌ Entendido, ${name}. Tu cita ha sido cancelada:\n\n📅 *Fecha:* ${dateStr}\n⏰ *Hora:* ${timeStr}\n💼 *Servicio:* ${serviceName}\n\nCuando quieras agendar de nuevo, aquí estamos. 😊`
    }
    default:
      return null
  }
}
