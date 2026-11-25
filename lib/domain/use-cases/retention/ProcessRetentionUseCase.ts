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
  RETENTION_LIMITS,
  type IRetentionMessenger,
  type ProcessRetentionInput,
  type ProcessRetentionResult,
} from './types'

/** No work performed (gated off or nothing to do). */
const NO_OP: ProcessRetentionResult = { sent: 0, failed: 0, capped: false }

/** Whether the owner turned win-back on. Limits are the platform's, never read from here. */
function isRetentionEnabled(settings: Record<string, unknown> | null): boolean {
  const retention = (settings?.retention ?? {}) as Record<string, unknown>
  return retention.enabled === true
}

/** The platform's per-business limit, lowered to what is left of the shared daily budget. */
function dailyLimit(maxSends: number | undefined): number {
  const left = maxSends === undefined ? RETENTION_LIMITS.perBusinessDaily : Math.max(0, Math.floor(maxSends))
  return Math.min(RETENTION_LIMITS.perBusinessDaily, left)
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
    if (!isRetentionEnabled(business.data.settings as Record<string, unknown> | null)) {
      return ok(NO_OP)
    }

    // No budget left for today ⇒ nothing to send (the clients wait for tomorrow).
    const dailyCap = dailyLimit(input.maxSends)
    if (dailyCap === 0) {
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
        businessId: input.businessId,
        clientId: client.id,
      })

      if (!result.ok) {
        failed++
        // A template/account/number failure repeats for every remaining client:
        // stop here and hand the reason to the caller instead of retrying it N times.
        if (result.failure.scope === 'platform') {
          return ok({ sent, failed, capped, aborted: result.failure })
        }
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
