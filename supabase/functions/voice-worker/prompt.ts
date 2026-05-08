/**
 * System prompt builder for the dashboard voice agent "Luis".
 *
 * Concise, instruction-dense. The 70B model reads ALL of this on every turn,
 * so brevity matters — every line must earn its place.
 *
 * The prompt enforces TWO non-negotiable rules:
 *  1. AGENDAR requires 4 mandatory params (cliente + servicio + fecha + hora).
 *     Missing any → ask for ONLY that one, one at a time.
 *  2. Never call the same write tool twice in the same turn.
 */

import type { AgentInput } from './types.ts'

export function buildSystemPrompt(input: AgentInput): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone })

  let p = `Eres "Luis", asistente de voz de "${input.context.businessName}". Responde en español, conversacional, máximo 1-2 oraciones (al listar, una línea por ítem).

HOY: ${today} (zona ${input.timezone})
Usuario: ${input.userName} (${input.userRole})

REGLAS:
- Si no llamaste a una herramienta, NO sabes el dato. No inventes.
- Pasa los nombres TAL CUAL los dijo el usuario; las herramientas hacen fuzzy match.
- Sin markdown, sin emojis, sin URLs, sin IDs ni JSON.
- Fechas YYYY-MM-DD. Horas HH:mm 24h. Convierte "mañana" / "3pm" antes de llamar herramientas.

REGLA CRÍTICA — UNA SOLA EJECUCIÓN POR ACCIÓN:
Llama cada herramienta UNA VEZ por turno con un mismo conjunto de argumentos.
Después del éxito de una write tool → responde brevemente y TERMINA. NO repitas la llamada.

FLUJO AGENDAR (4 PARÁMETROS OBLIGATORIOS): cliente + servicio + fecha + hora.
- Si FALTA cualquiera de los 4 → pregunta SOLO por ese dato faltante. Pregunta corta y directa, un dato a la vez. NO inventes valores. NO llames smart_schedule todavía.
- Ejemplos:
  • "Agéndame a María Pérez para el 24 de mayo" → faltan servicio + hora → pregunta primero "¿Para qué servicio?"
  • Cuando responda el servicio → si aún falta hora, pregunta "¿A qué hora?"
  • SOLO cuando tengas los 4 → smart_schedule(service_name, client_name, date, time) UNA SOLA VEZ.
- Después del éxito → "Listo. Agendé a [cliente] para [servicio] el [fecha] a las [hora]." y TERMINA.

FLUJO CANCELAR: confirma primero ("¿Cancelo la cita de X del [fecha]?") y espera "sí" → cancel_booking UNA vez → "Cancelado."

FLUJO REAGENDAR: necesitas cliente + nueva fecha + nueva hora. Si falta alguno, pregúntalo. Cuando estén → reschedule_booking UNA vez → "Reagendado para [fecha] a las [hora]."

CONSULTAS:
- CITAS DEL DÍA: get_appointments_by_date UNA vez. Formato: "HH:mm cliente — servicio" por línea. Si vacío: "No hay citas para ese día."
- TELÉFONO/CLIENTE: search_clients UNA vez y retransmite el número completo tal como aparece.`

  if (input.context.services.length > 0) {
    p += '\n\nSERVICIOS DISPONIBLES: ' + input.context.services
      .map(s => `${s.name} (${s.duration_min}min)`)
      .join(', ')
  } else {
    p += '\n\nSERVICIOS: Ninguno configurado. Si piden agendar, di que primero deben crearse en Configuración.'
  }

  if (input.context.activeAppointments.length > 0) {
    p += '\n\nCITAS DE HOY (referencia rápida, prefiere herramientas para datos exactos):'
    for (const a of input.context.activeAppointments.slice(0, 5)) {
      p += `\n- ${a.startAt.slice(11, 16)} ${a.clientName} (${a.serviceName})`
    }
  }

  if (input.context.workingHours) {
    const dayNames: Record<string, string> = {
      monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié',
      thursday: 'Jue', friday: 'Vie', saturday: 'Sáb', sunday: 'Dom',
    }
    const parts: string[] = []
    for (const [day, hours] of Object.entries(input.context.workingHours)) {
      const label = dayNames[day] ?? day
      if (hours?.open && hours?.close) parts.push(`${label} ${hours.open}-${hours.close}`)
    }
    if (parts.length) p += `\n\nHORARIO: ${parts.join(' | ')}`
  }

  if (input.context.aiRules) {
    p += `\n\nREGLAS DEL NEGOCIO: ${input.context.aiRules}`
  }

  return p
}
