import type { ConversationFlow } from '../../orchestrator/types'
import type { IUserStrategy } from '../../orchestrator/strategy'
import type { ToolDefEntry } from '../IAgent'

export type { ToolDefEntry }

// State machine: tools allowed per conversational flow.
// Prevents the LLM from calling off-flow tools (e.g. cancel_booking while collecting a booking).
// collecting_booking exposes only smart_schedule + get_services:
//   smart_schedule handles client resolution + availability check + booking internally,
//   eliminating the 3-step ReAct loop (search_clients → get_available_slots → confirm_booking).
export const TOOLS_BY_FLOW: Partial<Record<ConversationFlow, Set<string>>> = {
  collecting_booking:      new Set(['smart_schedule', 'get_services']),
  collecting_reschedule:   new Set(['reschedule_booking', 'get_appointments_by_date', 'get_available_slots', 'search_clients']),
  collecting_cancellation: new Set(['cancel_booking', 'get_appointments_by_date', 'search_clients']),
  answering_query:         new Set(['get_appointments_by_date', 'get_available_slots', 'get_services', 'search_clients']),
  // 'idle', 'executing', 'completed', 'awaiting_confirmation' → no restriction (role filter applies)
}

const ALL_DASHBOARD_TOOLS: ToolDefEntry[] = [
  // ── smart_schedule — ONE-SHOT booking tool ────────────────────────────────
  // Resolves client (auto-creates if new), checks availability, and creates the
  // appointment in a single call. Replaces the 3-step search→slots→confirm loop.
  {
    type: 'function',
    function: {
      name: 'smart_schedule',
      description:
        'Agenda una cita completa en un solo paso. Llama DIRECTAMENTE cuando tengas servicio + cliente + fecha + hora. ' +
        'NO llames search_clients ni get_available_slots antes — este tool los maneja internamente.',
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Nombre del servicio tal como lo dijo el usuario (ej. "Manicura").' },
          client_name:  { type: 'string', description: 'Nombre del cliente tal como lo dijo el usuario.' },
          date:         { type: 'string', description: 'Fecha YYYY-MM-DD.' },
          time:         { type: 'string', description: 'Hora HH:mm en formato 24h.' },
        },
        required: ['service_name', 'client_name', 'date', 'time'],
        additionalProperties: false,
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'confirm_booking',
      description: 'Crea una cita nueva. Pasa el nombre del servicio y del cliente tal como los dijo el usuario; el sistema los resuelve internamente.',
      parameters: {
        type: 'object',
        properties: {
          service_id:  { type: 'string', description: 'Nombre del servicio tal como lo dijo el usuario (ej. "Manicura").' },
          client_name: { type: 'string', description: 'Nombre del cliente tal como lo dijo el usuario.' },
          date:        { type: 'string', description: 'Fecha YYYY-MM-DD' },
          time:        { type: 'string', description: 'Hora HH:mm en formato 24h' },
        },
        required: ['service_id', 'client_name', 'date', 'time'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Cancela una cita. Pasa client_name (y opcionalmente date y time) — el sistema localiza la cita.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente cuya cita se cancela.' },
          date:        { type: 'string', description: 'Fecha YYYY-MM-DD (opcional, default = hoy).' },
          time:        { type: 'string', description: 'Hora HH:mm 24h (opcional, para desambiguar si hay varias del mismo cliente).' },
        },
        required: ['client_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_booking',
      description: 'Reagenda una cita. Pasa client_name (+ date/time de la cita actual si hay ambigüedad) y la nueva fecha/hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente cuya cita se reagenda.' },
          date:        { type: 'string', description: 'Fecha actual YYYY-MM-DD (opcional, default = hoy).' },
          time:        { type: 'string', description: 'Hora actual HH:mm 24h (opcional, para desambiguar).' },
          new_date:    { type: 'string', description: 'Nueva fecha YYYY-MM-DD' },
          new_time:    { type: 'string', description: 'Nueva hora HH:mm 24h' },
        },
        required: ['client_name', 'new_date', 'new_time'],
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
      description: 'Busca clientes por nombre antes de agendar. Tolera transcripciones imperfectas (fuzzy match). Devuelve solo nombres legibles.',
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

  // ── delete_client ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delete_client',
      description:
        'Elimina un cliente del sistema. Verifica automáticamente que no tenga citas futuras antes de borrar. ' +
        'Si tiene citas futuras, retorna un error con el conteo — cancélalas primero.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente a eliminar.' },
          client_id:   { type: 'string', description: 'UUID del cliente (opcional — mejora precisión si ya lo conoces).' },
        },
        required: ['client_name'],
        additionalProperties: false,
      },
    },
  },

  // ── check_duplicate_clients ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'check_duplicate_clients',
      description:
        'Detecta clientes con nombres muy similares (posibles duplicados por errores de captura o voz). ' +
        'Retorna grupos de candidatos para que el operador decida cuáles eliminar.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
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
