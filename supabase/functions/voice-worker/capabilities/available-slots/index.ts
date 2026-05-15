/**
 * get_available_slots — LLM-only. The intent is rare enough and the args
 * complex enough (date + duration) that a deterministic fast path would
 * carry more false-positive risk than latency savings.
 */

import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { executeAvailableSlots, type AvailableSlotsArgs } from './tool.ts'

export const availableSlotsCapability: ICapability<AvailableSlotsArgs> = {
  name:      'get_available_slots',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Consulta horarios libres para una fecha y duración.',
      parameters: {
        type: 'object',
        properties: {
          date:         { type: 'string', description: 'YYYY-MM-DD' },
          duration_min: { type: 'number', description: '5-480' },
        },
        required: ['date', 'duration_min'],
      },
    },
  },
  detectFastPath(_input: FastPathInput) {
    return null
  },
  execute: executeAvailableSlots,
}
