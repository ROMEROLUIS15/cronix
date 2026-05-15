/**
 * create_client — LLM-only. There is no useful fast path: registering a
 * brand-new client requires explicit user intent ("regístralo como cliente
 * nuevo") and a name we can't pull from context.
 */

import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { executeCreateClient, type CreateClientArgs } from './tool.ts'

export const createClientCapability: ICapability<CreateClientArgs> = {
  name:      'create_client',
  isWrite:   true,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Registra un cliente nuevo (cuando el usuario pida explícitamente registrar).',
      parameters: {
        type: 'object',
        properties: {
          name:  { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  detectFastPath(_input: FastPathInput) {
    return null
  },
  execute: executeCreateClient,
}
