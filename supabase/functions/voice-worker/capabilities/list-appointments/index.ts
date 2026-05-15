import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectListAppointments } from './fast-path.ts'
import { executeListAppointments, type ListAppointmentsArgs } from './tool.ts'

export const listAppointmentsCapability: ICapability<ListAppointmentsArgs> = {
  name:      'get_appointments_by_date',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_appointments_by_date',
      description: 'Lista citas de un día específico.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectListAppointments(input.text, input.today)
  },
  execute: executeListAppointments,
}
