/**
 * RegisterPaymentUseCase.ts
 *
 * Registers a payment for a completed appointment.
 */

import type { IFinanceRepository } from '@/lib/domain/repositories'
import type { RegisterPaymentInput } from './types'
import { ok, fail, type Result } from '@/types/result'

export class RegisterPaymentUseCase {
  constructor(
    private financeRepo: IFinanceRepository,
  ) {}

  async execute(input: RegisterPaymentInput): Promise<Result<void>> {
    const result = await this.financeRepo.createTransaction({
      business_id: input.businessId,
      appointment_id: input.appointmentId,
      net_amount: input.amount,
      payment_method: input.method,
      notes: input.notes ?? null,
    })

    if (result.error) {
      return fail(`No se pudo registrar el pago: ${result.error}`)
    }

    return ok(undefined)
  }
}
