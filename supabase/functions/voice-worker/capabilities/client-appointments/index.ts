import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectClientAppointments } from './fast-path.ts'
import { executeClientAppointments, type ClientAppointmentsArgs } from './tool.ts'

export const clientAppointmentsCapability: ICapability<ClientAppointmentsArgs> = {
  name:      'get_client_appointments',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_client_appointments',
      description: 'Lista las citas próximas (futuras, activas) de UN cliente específico. Úsala cuando pregunten "qué citas tiene X" o "cuándo viene X". NO la uses para listar el día completo (eso es get_appointments_by_date).',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string', description: 'Nombre del cliente tal como lo dijo el usuario' },
        },
        required: ['client_name'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectClientAppointments(input.text, input.today, input.services)
  },
  execute: executeClientAppointments,
}
