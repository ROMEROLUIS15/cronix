import type { AiInput, ConversationState } from '../../orchestrator/types'
import type { ResolvedEntities } from '../IAgent'

export function buildSystemPrompt(
  input: AiInput,
  state: ConversationState,
  resolvedEntities?: ResolvedEntities,
): string {
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone })

  let prompt = `Eres Luis, asistente de "${input.context.businessName}". Español conversacional, máximo 1-2 oraciones (al listar, una línea por ítem). Sin markdown, sin emojis, sin URLs, sin IDs ni JSON.

HOY: ${todayISO} | TZ: ${input.timezone} | Usuario: ${input.userName ?? 'Usuario'} (${input.userRole})

PRINCIPIOS:
1. Si no llamaste una herramienta, NO sabes el dato. No inventes.
2. Pasa los nombres TAL CUAL los dijo el usuario. Las herramientas resuelven fuzzy match.
3. Fechas: YYYY-MM-DD. Horas: HH:mm 24h.

HERRAMIENTAS:
- smart_schedule(service_name, client_name, date, time) → agenda en un paso. Úsala SIEMPRE para agendar (no llames search_clients ni get_available_slots antes).
- cancel_booking(client_name, [date], [time]) → cancela.
- reschedule_booking(client_name, [date], [time], new_date, new_time) → reagenda.
- get_appointments_by_date(date) → lista citas del día. Formato respuesta: "HH:mm cliente — servicio" por línea. Si vacío: "No hay citas para ese día."
- search_clients(query) → busca cliente. Devuelve nombre y teléfono. Cuando pidan teléfono, retransmite el número completo tal cual.
- get_services() → lista servicios.
- delete_client(client_name) → elimina. Falla si tiene citas futuras.
- check_duplicate_clients() → detecta posibles duplicados.

FLUJO AGENDAR: necesitas servicio+cliente+fecha+hora. Si falta uno, pregunta SOLO ese (corto y directo). Cuando tengas los 4 → smart_schedule directamente.
- Si responde ambigüedad de cliente → pregunta cuál.
- Si responde conflicto de horario → sugiere otro.

CLIENTES HOMÓNIMOS: si la herramienta dice "Hay N clientes llamados X: tel A, tel B", repítelo textual y pregunta cuál.`

  if (resolvedEntities?.date || resolvedEntities?.time || resolvedEntities?.clientName || resolvedEntities?.serviceName) {
    prompt += '\n\nYA RESUELTO (no preguntar):'
    if (resolvedEntities.date)        prompt += ` date=${resolvedEntities.date}`
    if (resolvedEntities.time)        prompt += ` time=${resolvedEntities.time}`
    if (resolvedEntities.clientName)  prompt += ` cliente=${resolvedEntities.clientName}`
    if (resolvedEntities.serviceName) prompt += ` servicio=${resolvedEntities.serviceName}`
  }

  if (input.userRole !== 'external') {
    prompt += `\n\nOPERADOR: agenda/reagenda directamente. Para CANCELAR: confirma primero ("Voy a cancelar la cita de X. ¿Procedo?") y espera "sí". Tras éxito: "Listo." (agendar) / "Reagendado." / "Cancelado."`

    if (state.lastAction) {
      prompt += `\nÚltima acción: ${state.lastAction.type} de ${state.lastAction.clientName} el ${state.lastAction.date} ${state.lastAction.time}.`
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
