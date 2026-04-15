/**
 * CreateClientUseCase.ts
 *
 * Creates a new client for a business. Used by the AI assistant when booking
 * for a client that doesn't exist yet in the system.
 */

import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import { ok, fail, type Result } from '@/types/result'

export interface CreateClientInput {
  businessId: string
  name:        string
  phone?:      string
}

export class CreateClientUseCase {
  constructor(private clientRepo: IClientRepository) {}

  async execute(input: CreateClientInput): Promise<Result<ClientForAI>> {
    const trimmedName = input.name.trim()
    if (!trimmedName) {
      return fail('El nombre del cliente no puede estar vacío.')
    }

    const result = await this.clientRepo.insert({
      business_id: input.businessId,
      name:        trimmedName,
      phone:       input.phone?.trim() ?? '',
    })

    if (result.error || !result.data) {
      return fail(result.error ?? 'No se pudo registrar al cliente.')
    }

    return ok(result.data)
  }
}
