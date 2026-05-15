import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectSchedule } from './fast-path.ts'
import { executeSchedule, type ScheduleArgs } from './tool.ts'

export const scheduleCapability: ICapability<ScheduleArgs> = {
  name:      'smart_schedule',
  isWrite:   true,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'smart_schedule',
      description: 'Agenda una cita en un solo paso. Llama SOLO cuando tengas servicio + cliente + fecha + hora.',
      parameters: {
        type: 'object',
        properties: {
          service_name:        { type: 'string',  description: 'Nombre del servicio' },
          client_name:         { type: 'string',  description: 'Nombre del cliente' },
          date:                { type: 'string',  description: 'YYYY-MM-DD' },
          time:                { type: 'string',  description: 'HH:mm 24h' },
          register_new_client: { type: 'boolean', description: 'true SOLO cuando el usuario confirma explícitamente que registres un cliente que no existe (ej: dijo "sí, regístralo y agenda")' },
        },
        required: ['service_name', 'client_name', 'date', 'time'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectSchedule(input.text, input.today, input.services)
  },
  execute: executeSchedule,
}
