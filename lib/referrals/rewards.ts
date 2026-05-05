import { PLAN_LIMITS, MAX_BONUS_APPOINTMENTS } from '@/lib/plans/plan-limits'

export interface ReferralRewardInfo {
  isFree: boolean
  currentBonus: number
  baseLimit: number
  maxBonus: number
  progressPercentage: number
}

/**
 * Pure function — derives all reward display data from raw business fields.
 * No side effects, no DB access, no UI dependencies.
 */
export function getReferralRewardInfo(
  plan: string | null,
  bonusLimit: number | null,
): ReferralRewardInfo {
  const isFree = (plan ?? 'free') === 'free'
  const currentBonus = bonusLimit ?? 0
  const baseLimit = PLAN_LIMITS.free.appointmentsPerMonth

  return {
    isFree,
    currentBonus,
    baseLimit,
    maxBonus: MAX_BONUS_APPOINTMENTS,
    progressPercentage: isFree
      ? Math.min(100, (currentBonus / MAX_BONUS_APPOINTMENTS) * 100)
      : 100,
  }
}
