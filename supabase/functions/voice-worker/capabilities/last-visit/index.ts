import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectLastVisit } from './fast-path.ts'
import { executeLastVisit, type LastVisitArgs } from './tool.ts'

export const lastVisitCapability: ICapability<LastVisitArgs> = {
  name:      'get_last_visit',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_last_visit',
      description: 'Devuelve la última cita pasada de un cliente: fecha, servicio y si asistió, no asistió o fue cancelada.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente' } },
        required: ['client_name'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectLastVisit(input.text)
  },
  execute: executeLastVisit,
}
