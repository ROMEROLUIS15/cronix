import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectReschedule } from './fast-path.ts'
import { executeReschedule, type RescheduleArgs } from './tool.ts'

export const rescheduleCapability: ICapability<RescheduleArgs> = {
  name:      'reschedule_booking',
  isWrite:   true,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'reschedule_booking',
      description: 'Reagenda una cita a una nueva fecha/hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD actual (opcional)' },
          time:        { type: 'string', description: 'HH:mm actual (opcional)' },
          new_date:    { type: 'string', description: 'YYYY-MM-DD nuevo' },
          new_time:    { type: 'string', description: 'HH:mm nuevo' },
        },
        required: ['client_name'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectReschedule(
      input.text,
      input.today,
      input.lastRef
        ? { clientName: input.lastRef.clientName, appointmentId: input.lastRef.appointmentId }
        : null,
    )
  },
  execute: executeReschedule,
}
