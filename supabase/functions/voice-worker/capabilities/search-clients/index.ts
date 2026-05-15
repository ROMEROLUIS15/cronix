import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectSearchClients } from './fast-path.ts'
import { executeSearchClients, type SearchClientsArgs } from './tool.ts'

export const searchClientsCapability: ICapability<SearchClientsArgs> = {
  name:      'search_clients',
  isWrite:   false,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca un cliente por nombre. Devuelve nombre y teléfono.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Mínimo 2 caracteres' } },
        required: ['query'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectSearchClients(input.text)
  },
  execute: executeSearchClients,
}
