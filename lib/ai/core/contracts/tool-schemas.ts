/**
 * tool-schemas.ts — Schemas Zod canónicos para todos los tools de IA.
 *
 * ÚNICA fuente de verdad para:
 *   1. Validación de argumentos del LLM (runtime)
 *   2. Generación de tool definitions para la API del LLM (estático)
 *
 * Antes: schemas duplicados en RealToolExecutor.ts y appointment.tools.ts
 * Ahora: un schema → BookingEngine lo usa, los adapters lo exponen al LLM
 */

import { z } from 'zod'

// ── Tipos base reutilizables ───────────────────────────────────────────────────

const ISODate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Formato requerido: YYYY-MM-DD')
const HHmm    = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato requerido: HH:mm en 24h (ej: 15:00)')
const UUID    = z.string().uuid('UUID inválido')

// ── confirm_booking ───────────────────────────────────────────────────────────

export const ConfirmBookingSchema = z.object({
  /** Nombre o UUID del servicio. El resolver hace fuzzy match si es nombre. */
  service_id:  z.string().min(1, 'Requerido'),
  date:        ISODate,
  time:        HHmm,
  /** Por nombre (dashboard: owner dicta el nombre del cliente) */
  client_name: z.string().min(1).optional(),
  /** Por ID (cuando ya fue resuelto en un turno previo) */
  client_id:   UUID.optional(),
  /** Personal asignado (opcional) */
  staff_id:    UUID.optional(),
}).refine(
  (v) => v.client_name ?? v.client_id,
  { message: 'Necesito el nombre o ID del cliente.' }
)

export type ConfirmBookingInput = z.infer<typeof ConfirmBookingSchema>

// ── cancel_booking ────────────────────────────────────────────────────────────

export const CancelBookingSchema = z.union([
  z.object({ appointment_id: UUID }),
  z.object({
    client_name: z.string().min(1),
    date:        ISODate.optional(),
    time:        HHmm.optional(),
  }),
])

export type CancelBookingInput = z.infer<typeof CancelBookingSchema>

// ── reschedule_booking ────────────────────────────────────────────────────────

export const RescheduleBookingSchema = z.object({
  new_date: ISODate,
  new_time: HHmm,
}).and(z.union([
  z.object({ appointment_id: UUID }),
  z.object({
    client_name: z.string().min(1),
    date:        ISODate.optional(),
    time:        HHmm.optional(),
  }),
]))

export type RescheduleBookingInput = z.infer<typeof RescheduleBookingSchema>

// ── get_available_slots ───────────────────────────────────────────────────────

export const GetAvailableSlotsSchema = z.object({
  date:         ISODate,
  duration_min: z.number().int().min(5).max(480),
})

export type GetAvailableSlotsInput = z.infer<typeof GetAvailableSlotsSchema>

// ── get_appointments_by_date ──────────────────────────────────────────────────

export const GetByDateSchema = z.object({
  date: ISODate,
})

export type GetByDateInput = z.infer<typeof GetByDateSchema>

// ── create_client ─────────────────────────────────────────────────────────────

export const CreateClientSchema = z.object({
  name:  z.string().min(1).max(120),
  phone: z.string().max(30).optional(),
})

export type CreateClientInput = z.infer<typeof CreateClientSchema>

// ── search_clients ────────────────────────────────────────────────────────────

export const SearchClientsSchema = z.object({
  query: z.string().min(2).max(80),
})

export type SearchClientsInput = z.infer<typeof SearchClientsSchema>

// ── Generador de tool definitions para el LLM ─────────────────────────────────
// Los channel adapters llaman buildToolDefs() para obtener el array de tools
// que pasan a la API del LLM. Única fuente de verdad para las descripciones.

export type LlmToolDef = {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters:  Record<string, unknown>
  }
}

export const TOOL_DEFS: Record<string, LlmToolDef> = {
  confirm_booking: {
    type: 'function',
    function: {
      name:        'confirm_booking',
      description: 'Crea una cita nueva. Llamar SOLO después de confirmación explícita del usuario. Incluye siempre service_id, date (YYYY-MM-DD), time (HH:mm 24h) y client_name o client_id.',
      parameters: {
        type: 'object',
        required: ['service_id', 'date', 'time'],
        properties: {
          service_id:  { type: 'string', description: 'Nombre del servicio tal como lo dijo el usuario, o UUID si ya está resuelto.' },
          date:        { type: 'string', description: 'Fecha YYYY-MM-DD.' },
          time:        { type: 'string', description: 'Hora HH:mm en 24h (ej: 15:00 para 3 PM). Convierte si el usuario dijo "3 PM".' },
          client_name: { type: 'string', description: 'Nombre del cliente tal como lo dijo el usuario.' },
          client_id:   { type: 'string', description: 'UUID del cliente si ya fue resuelto por search_clients.' },
          staff_id:    { type: 'string', description: 'UUID del empleado asignado (opcional).' },
        },
        additionalProperties: false,
      },
    },
  },

  cancel_booking: {
    type: 'function',
    function: {
      name:        'cancel_booking',
      description: 'Cancela una cita. Usar appointment_id si está disponible, o client_name + date para localizarla.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita (preferido).' },
          client_name:    { type: 'string', description: 'Nombre del cliente (alternativo).' },
          date:           { type: 'string', description: 'Fecha YYYY-MM-DD (para desambiguar).' },
          time:           { type: 'string', description: 'Hora HH:mm (para desambiguar).' },
        },
        additionalProperties: false,
      },
    },
  },

  reschedule_booking: {
    type: 'function',
    function: {
      name:        'reschedule_booking',
      description: 'Reagenda una cita a nueva fecha/hora. Llamar SOLO después de confirmación explícita.',
      parameters: {
        type: 'object',
        required: ['new_date', 'new_time'],
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita (preferido).' },
          client_name:    { type: 'string', description: 'Nombre del cliente (alternativo).' },
          date:           { type: 'string', description: 'Fecha actual de la cita (para desambiguar).' },
          time:           { type: 'string', description: 'Hora actual de la cita (para desambiguar).' },
          new_date:       { type: 'string', description: 'Nueva fecha YYYY-MM-DD.' },
          new_time:       { type: 'string', description: 'Nueva hora HH:mm 24h.' },
        },
        additionalProperties: false,
      },
    },
  },

  get_available_slots: {
    type: 'function',
    function: {
      name:        'get_available_slots',
      description: 'Consulta horarios disponibles para una fecha y duración. SIEMPRE llamar antes de confirm_booking si no se sabe si el horario está libre.',
      parameters: {
        type: 'object',
        required: ['date', 'duration_min'],
        properties: {
          date:         { type: 'string', description: 'Fecha YYYY-MM-DD.' },
          duration_min: { type: 'number', description: 'Duración del servicio en minutos.' },
        },
        additionalProperties: false,
      },
    },
  },

  get_appointments_by_date: {
    type: 'function',
    function: {
      name:        'get_appointments_by_date',
      description: 'Lista las citas de un día específico.',
      parameters: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', description: 'Fecha YYYY-MM-DD.' },
        },
        additionalProperties: false,
      },
    },
  },

  create_client: {
    type: 'function',
    function: {
      name:        'create_client',
      description: 'Registra un cliente nuevo. Usar cuando confirm_booking falla por cliente no encontrado y el usuario proporciona datos.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name:  { type: 'string', description: 'Nombre completo del cliente.' },
          phone: { type: 'string', description: 'Teléfono (opcional).' },
        },
        additionalProperties: false,
      },
    },
  },

  search_clients: {
    type: 'function',
    function: {
      name:        'search_clients',
      description: 'Busca un cliente por nombre antes de agendar. Tolera errores de transcripción.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Nombre o parte del nombre (mínimo 2 caracteres).' },
        },
        additionalProperties: false,
      },
    },
  },
}
