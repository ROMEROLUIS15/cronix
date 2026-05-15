import type { ICapability, FastPathInput } from '../_shared/Capability.ts'
import { detectDeleteClient } from './fast-path.ts'
import { executeDeleteClient, type DeleteClientArgs } from './tool.ts'

export const deleteClientCapability: ICapability<DeleteClientArgs> = {
  name:      'delete_client',
  isWrite:   true,
  bypassLLM: true,
  definition: {
    type: 'function',
    function: {
      name: 'delete_client',
      description: 'Elimina un cliente. Pasa phone cuando dos clientes compartan el nombre. Pasa any_duplicate=true cuando el usuario diga "elimina a cualquiera" / "borra los duplicados" / "elimina uno". Falla si tiene citas futuras.',
      parameters: {
        type: 'object',
        properties: {
          client_name:   { type: 'string' },
          phone:         { type: 'string',  description: 'Teléfono para desambiguar entre clientes con el mismo nombre' },
          any_duplicate: { type: 'boolean', description: 'true cuando el usuario consintió borrar uno de los duplicados sin importar cuál' },
        },
        required: ['client_name'],
      },
    },
  },
  detectFastPath(input: FastPathInput) {
    return detectDeleteClient(input.text, input.history)
  },
  execute: executeDeleteClient,
}
