/**
 * ProcessRetentionUseCase.ts
 *
 * Orchestrates one re-engagement run for a single business (the cron iterates
 * businesses with retention enabled). Hands-off: gated by plan + toggle, capped
 * per run, sends the approved Meta template and stamps the anti-spam guard on
 * every success.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §4 (+ AC-5, AC-6, AC-7, AC-11).
 */

import type { IClientRepository } from '@/lib/domain/repositories'
import type { IBusinessRepository } from '@/lib/domain/repositories/IBusinessRepository'
import { ok, fail, type Result } from '@/types/result'
import { canAccessRetention } from '@/lib/plans/plan-limits'
import { GetEligibleClientsUseCase } from './GetEligibleClientsUseCase'
import {
  RETENTION_DEFAULTS,
  type IRetentionMessenger,
  type ProcessRetentionInput,
  type ProcessRetentionResult,
} from './types'

/** No work performed (gated off or nothing to do). */
const NO_OP: ProcessRetentionResult = { sent: 0, failed: 0, capped: false }

function readRetentionConfig(
  settings: Record<string, unknown> | null,
): { enabled: boolean; dailyCap: number } {
  const retention = (settings?.retention ?? {}) as Record<string, unknown>
  const enabled = retention.enabled === true
  const dailyCap =
    typeof retention.dailyCap === 'number' && retention.dailyCap > 0
      ? retention.dailyCap
      : RETENTION_DEFAULTS.dailyCap
  return { enabled, dailyCap }
}

export class ProcessRetentionUseCase {
  constructor(
    private businessRepo: IBusinessRepository,
    private clientRepo: IClientRepository,
    private getEligible: GetEligibleClientsUseCase,
    private messenger: IRetentionMessenger,
  ) {}

  async execute(input: ProcessRetentionInput): Promise<Result<ProcessRetentionResult>> {
    const business = await this.businessRepo.getById(input.businessId)
    if (business.error || !business.data) {
      return fail('No se pudo cargar el negocio para la retención.')
    }

    // AC-11: only Pro+ runs. Free is a no-op (the dashboard also blocks the toggle).
    if (!canAccessRetention(business.data.plan ?? 'free')) {
      return ok(NO_OP)
    }

    // AC-5: consent toggle. Off ⇒ no-op, zero sends.
    const { enabled, dailyCap } = readRetentionConfig(
      business.data.settings as Record<string, unknown> | null,
    )
    if (!enabled) {
      return ok(NO_OP)
    }

    const eligible = await this.getEligible.execute({ businessId: input.businessId })
    if (eligible.error || !eligible.data) {
      return fail(eligible.error ?? 'No se pudieron obtener los clientes elegibles.')
    }

    // AC-6: cap per run; the overflow rolls into the next run.
    const capped = eligible.data.length > dailyCap
    const batch = eligible.data.slice(0, dailyCap)
    const businessName = business.data.name

    let sent = 0
    let failed = 0

    for (const client of batch) {
      const result = await this.messenger.sendWinback({
        to: client.phone,
        clientName: client.name,
        businessName,
      })

      if (result.error) {
        failed++
        continue
      }

      // AC-7: a successful send stamps last_reengaged_at (anti-spam) and
      // invalidates the dashboard cache (handled inside the repo seam).
      await this.clientRepo.updateLastReengaged(client.id, input.businessId)
      sent++
    }

    return ok({ sent, failed, capped })
  }
}
