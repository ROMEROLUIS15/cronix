import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectCancel } from './fast-path.ts'
import { executeCancel, type CancelArgs } from './tool.ts'

export const cancelCapability: ICapability<CancelArgs> = {
  name:      'cancel_booking',
  isWrite:   true,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Cancela una cita. Pasa client_name; date/time opcionales para desambiguar.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD opcional' },
          time:        { type: 'string', description: 'HH:mm opcional' },
        },
        required: ['client_name'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectCancel(
      input.text,
      input.today,
      input.lastRef
        ? { clientName: input.lastRef.clientName, appointmentId: input.lastRef.appointmentId }
        : null,
    )
  },
  execute: executeCancel,
}
