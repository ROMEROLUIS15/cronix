/**
 * get_services — read-only catalog lookup. Deterministic fast path for the
 * common question shapes ("qué servicios tienes", "servicios disponibles");
 * anything else ("qué puedes hacer") still reaches the LLM, whose system
 * prompt knows when to call this tool.
 */

import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { executeGetServices, type GetServicesArgs } from './tool.ts'
import { detectGetServices } from './fast-path.ts'

export const getServicesCapability: ICapability<GetServicesArgs> = {
  name:      'get_services',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'get_services',
      description: 'Lista los servicios del negocio.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectGetServices(input.text)
  },
  execute: (ctx, _args) => executeGetServices(ctx),
}
