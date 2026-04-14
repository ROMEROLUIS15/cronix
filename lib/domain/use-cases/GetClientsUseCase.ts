/**
 * GetClientsUseCase.ts
 */

import type { IClientRepository } from '@/lib/domain/repositories'
import type { GetClientsInput, ClientSummary } from './types'
import { ok, fail, type Result } from '@/types/result'

export class GetClientsUseCase {
  constructor(
    private clientRepo: IClientRepository,
  ) {}

  async execute(input: GetClientsInput): Promise<Result<ClientSummary[]>> {
    const result = await this.clientRepo.findActiveForAI(input.businessId)

    if (result.error) {
      return fail('Error al consultar los clientes.')
    }

    let clients = (result.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: null as string | null,
    }))

    // Filter by query if provided (simple substring match — fuzzy matching is at ToolAdapter level)
    if (input.query && input.query.trim().length > 0) {
      const q = input.query.toLowerCase()
      clients = clients.filter((c) => c.name.toLowerCase().includes(q))
    }

    return ok(clients)
  }
}
