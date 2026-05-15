/**
 * get_services — read-only catalog lookup. LLM-only: there's no useful fast
 * path because the user can phrase this dozens of ways ("qué servicios
 * ofreces", "lista los servicios", "qué puedes hacer") and the cost of a
 * wrong fast-path classification outweighs the latency win. The system
 * prompt knows when to call this tool.
 */

import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { executeGetServices, type GetServicesArgs } from './tool.ts'

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
  detectFastPath(_input: FastPathInput) {
    return null
  },
  execute: (ctx, _args) => executeGetServices(ctx),
}
