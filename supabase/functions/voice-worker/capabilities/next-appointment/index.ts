import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectNextAppointment } from './fast-path.ts'
import { executeNextAppointment, type NextAppointmentArgs } from './tool.ts'

export const nextAppointmentCapability: ICapability<NextAppointmentArgs> = {
  name:      'get_next_appointment',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_next_appointment',
      description: 'Devuelve la primera cita futura relativa al instante actual del negocio. Úsala cuando el usuario pregunta por su "próxima cita" / "siguiente cita" sin nombrar una fecha.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectNextAppointment(input.text)
  },
  execute: executeNextAppointment,
}
