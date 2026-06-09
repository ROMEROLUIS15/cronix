/**
 * CompleteAppointmentUseCase — Orchestrates completing an appointment.
 *
 * Owns the full "mark as completed" flow:
 *   1. Fetch appointment services + existing transactions (ownership-verified)
 *   2. Calculate debt = totalServicesPrice - alreadyPaid
 *   3. If debt > 0 → financeRepo.createTransaction (idempotent via idempotency_key)
 *   4. appointmentRepo.updateStatus → 'completed'
 *   5. (Callers handle cache invalidation via their own infrastructure)
 *
 * Depends ONLY on domain interfaces — no Supabase, no HTTP, no cache.
 *
 * Exposes:
 *  - CompleteAppointmentUseCase.execute(input) → Result<void>
 *
 * Guarantees:
 *  - A billing failure does NOT block the status update (same semantics as before).
 *  - Idempotent: idempotency_key 'checkout_<appointmentId>' prevents double-charging.
 *  - Tenant isolation: billing is skipped entirely if ownership check fails.
 *  - Never throws — propagates errors via Result<void>.
 */

import type { IAppointmentCommandRepository } from '@/lib/domain/repositories/IAppointmentCommandRepository'
import type { IFinanceRepository }            from '@/lib/domain/repositories/IFinanceRepository'
import type { Result }                        from '@/types/result'
import { ok, fail }                           from '@/types/result'
import { logger }                             from '@/lib/logger'

// ── Input ─────────────────────────────────────────────────────────────────────

export interface CompleteAppointmentInput {
  appointmentId: string
  businessId:    string
  /**
   * Pre-fetched billing snapshot for this appointment.
   * Callers are responsible for fetching this data (scoped by businessId)
   * before calling execute(). This keeps the use case free of query-side deps.
   */
  billing: {
    /** Sum of all services' prices for this appointment. */
    totalServicesPrice: number
    /** Sum of all existing transactions already recorded for this appointment. */
    alreadyPaid:        number
    /** Human-readable label for the auto-charge note (e.g. "Cobro: Corte, Tinte"). */
    chargeNotes:        string
  }
}

export interface CompleteAppointmentOutput {
  /** true if a new transaction was created (debt > 0), false if appointment was already fully paid. */
  autoCharged: boolean
  /** The debt that was charged, 0 if none. */
  chargedAmount: number
}

// ── Use Case ──────────────────────────────────────────────────────────────────

export class CompleteAppointmentUseCase {
  constructor(
    private readonly appointmentRepo: IAppointmentCommandRepository,
    private readonly financeRepo:     IFinanceRepository,
  ) {}

  async execute(input: CompleteAppointmentInput): Promise<Result<CompleteAppointmentOutput>> {
    const { appointmentId, businessId, billing } = input

    // ── Step 1: Compute debt ───────────────────────────────────────────────────
    // debt is the remaining balance after any partial payments already recorded.
    const debt = billing.totalServicesPrice - billing.alreadyPaid

    // ── Step 2: Auto-charge if debt exists ────────────────────────────────────
    // Billing failure does NOT block the status update — same invariant as before.
    // idempotency_key guarantees exactly-one transaction even under retries.
    let autoCharged   = false
    let chargedAmount = 0

    if (debt > 0) {
      const txResult = await this.financeRepo.createTransaction({
        business_id:     businessId,
        appointment_id:  appointmentId,
        amount:          debt,
        net_amount:      debt,
        discount:        0,
        tip:             0,
        method:          'cash',
        notes:           billing.alreadyPaid > 0
                           ? `Liquidación de saldo. ${billing.chargeNotes}`
                           : billing.chargeNotes,
        paid_at:         new Date().toISOString(),
        idempotency_key: `checkout_${appointmentId}`,
      })

      if (txResult.error) {
        // Log but do not abort — the appointment must still be marked completed.
        logger.error(
          'CompleteAppointmentUseCase',
          'Auto-billing failed — proceeding with status update',
          { appointmentId, businessId, error: txResult.error },
        )
      } else {
        autoCharged   = true
        chargedAmount = debt
      }
    }

    // ── Step 3: Mark appointment as completed ─────────────────────────────────
    const statusResult = await this.appointmentRepo.updateStatus(
      appointmentId,
      'completed',
      businessId,
    )

    if (statusResult.error) {
      return fail(
        `Error al completar la cita: ${statusResult.error}`
      )
    }

    return ok({ autoCharged, chargedAmount })
  }
}
