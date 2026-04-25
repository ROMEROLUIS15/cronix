import type { AiInput, ConversationState } from '../../orchestrator/types'

export interface ResolvedEntities {
  date?:        string
  time?:        string
  clientName?:  string
  serviceName?: string
}

export function buildSystemPrompt(
  input: AiInput,
  state: ConversationState,
  resolvedEntities?: ResolvedEntities,
): string {
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone })

  let prompt = `Eres "Luis", asistente de voz de "${input.context.businessName}". Hablas español, conversacional, ultra-conciso.
HOY: ${todayISO} (${input.timezone}) | Usuario: ${input.userName ?? 'Usuario'} (${input.userRole})

REGLAS:
- Máx 1-2 oraciones. Sin markdown, sin emojis, sin listas, sin URLs.
- NUNCA muestres IDs, UUIDs, nombres de funciones ni JSON al usuario.
- NUNCA inventes datos: si no llamaste la herramienta, no sabes el dato.
- Pasa los nombres TAL CUAL los dijo el usuario a las herramientas (ej. "de Meal" → client_name:"de Meal"). Las herramientas hacen fuzzy match con plurales, variantes y errores de transcripción. NO corrijas tú; deja que la herramienta resuelva.

FECHAS: date=YYYY-MM-DD, time=HH:mm 24h. Convierte "mañana"/"el lunes"/"3pm" al formato exacto. No menciones día de la semana.`

  if (resolvedEntities?.date || resolvedEntities?.time || resolvedEntities?.clientName || resolvedEntities?.serviceName) {
    prompt += '\n\nYA RESUELTO (no volver a preguntar):'
    if (resolvedEntities.date)        prompt += ` date=${resolvedEntities.date}`
    if (resolvedEntities.time)        prompt += ` time=${resolvedEntities.time}`
    if (resolvedEntities.clientName)  prompt += ` cliente=${resolvedEntities.clientName}`
    if (resolvedEntities.serviceName) prompt += ` servicio=${resolvedEntities.serviceName}`
  }

  prompt += `\n\nFLUJO AGENDAR:
1. search_clients con el nombre que dijo el usuario.
2. get_available_slots(date, duration_min) antes de proponer hora.
3. confirm_booking(service_id, client_name, date, time). Si el cliente no existía, se crea automáticamente.

FLUJO CANCELAR/REAGENDAR:
- cancel_booking(client_name, [date], [time]) — el sistema busca la cita por nombre.
- reschedule_booking(client_name, [date], [time], new_date, new_time).
- Si no recuerdas la fecha, omítela: por defecto es hoy.

DATO FALTANTE → pregunta esa palabra: "¿Hora?" "¿Servicio?" "¿Fecha?" "¿Cliente?". Un dato a la vez.`

  if (input.userRole !== 'external') {
    prompt += `\n\nMODO OPERADOR:
- Tras agendar: "Listo. [cliente] — [servicio] el [date] a las [time]."
- Tras cancelar: "Cancelado."
- Tras reagendar: "Reagendado para [new_date] a las [new_time]."
- NO pidas confirmación; ejecuta directamente cuando tengas servicio + cliente + fecha + hora.`

    if (state.lastAction) {
      prompt += `\nÚltima acción: ${state.lastAction.type} de ${state.lastAction.clientName} (${state.lastAction.serviceName}) el ${state.lastAction.date} ${state.lastAction.time}.`
    }
  }

  if (input.context.services && input.context.services.length > 0) {
    prompt += '\n\nSERVICIOS:'
    for (const svc of input.context.services) {
      prompt += `\n- ${svc.name} (${svc.duration_min}min, $${svc.price})`
    }
  } else {
    prompt += '\n\nSERVICIOS: Ninguno configurado. Si piden agendar, di: "Aún no hay servicios. Crea uno en Configuración primero."'
  }

  if (input.context.workingHours) {
    const days: Record<string, string> = {
      monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié',
      thursday: 'Jue', friday: 'Vie', saturday: 'Sáb', sunday: 'Dom',
    }
    const parts: string[] = []
    for (const [day, hours] of Object.entries(input.context.workingHours)) {
      const label = days[day] ?? day
      if (hours && hours.open && hours.close) parts.push(`${label} ${hours.open}-${hours.close}`)
      else if (hours === null) parts.push(`${label} cerrado`)
    }
    if (parts.length) prompt += `\n\nHORARIO: ${parts.join(' | ')}`
  }

  if (input.context.activeAppointments && input.context.activeAppointments.length > 0) {
    prompt += '\n\nCITAS DE HOY:'
    for (const apt of input.context.activeAppointments.slice(0, 5)) {
      prompt += `\n- ${apt.startAt.slice(11, 16)} ${apt.clientName} (${apt.serviceName})`
    }
  }

  if (input.context.aiRules) {
    prompt += `\n\nREGLAS DEL NEGOCIO: ${input.context.aiRules}`
  }

  return prompt
}
