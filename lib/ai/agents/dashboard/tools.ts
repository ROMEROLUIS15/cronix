import type { ConversationFlow } from '../../orchestrator/types'
import type { IUserStrategy } from '../../orchestrator/strategy'

export type ToolDefEntry = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[] }>
      required: string[]
      additionalProperties: false
    }
  }
}

// State machine: tools allowed per conversational flow.
// Prevents the LLM from calling off-flow tools (e.g. cancel_booking while collecting a booking).
export const TOOLS_BY_FLOW: Partial<Record<ConversationFlow, Set<string>>> = {
  collecting_booking:      new Set(['confirm_booking', 'create_client', 'get_available_slots', 'get_services', 'search_clients']),
  collecting_reschedule:   new Set(['reschedule_booking', 'get_appointments_by_date', 'get_available_slots', 'search_clients']),
  collecting_cancellation: new Set(['cancel_booking', 'get_appointments_by_date', 'search_clients']),
  answering_query:         new Set(['get_appointments_by_date', 'get_available_slots', 'get_services', 'search_clients']),
  // 'idle', 'executing', 'completed', 'awaiting_confirmation' → no restriction (role filter applies)
}

const ALL_DASHBOARD_TOOLS: ToolDefEntry[] = [
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
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca clientes por nombre antes de agendar. Úsala cuando el nombre del cliente puede ser ambiguo o para verificar si ya existe y obtener su client_id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nombre o parte del nombre a buscar (mínimo 2 caracteres)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
]

export function buildToolDefsForRole(
  strategy: IUserStrategy,
  flow: ConversationFlow = 'idle',
): ToolDefEntry[] {
  // 1. Filter by role strategy permissions
  const roleFiltered = ALL_DASHBOARD_TOOLS.filter((tool) => strategy.canExecute(tool.function.name))

  // 2. Filter by current flow state (state machine restriction)
  const flowAllowList = TOOLS_BY_FLOW[flow]
  if (!flowAllowList) return roleFiltered
  return roleFiltered.filter((tool) => flowAllowList.has(tool.function.name))
}
