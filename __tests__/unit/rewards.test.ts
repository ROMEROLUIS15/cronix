import { describe, it, expect } from 'vitest';
import { getReferralRewardInfo } from '@/lib/referrals/rewards';
import { MAX_BONUS_APPOINTMENTS, PLAN_LIMITS } from '@/lib/plans/plan-limits';

describe('getReferralRewardInfo', () => {
  // ─── isFree flag ────────────────────────────────────────────────────────────

  it('is free when plan is "free"', () => {
    expect(getReferralRewardInfo('free', null).isFree).toBe(true);
  });

  it('is free when plan is null', () => {
    expect(getReferralRewardInfo(null, null).isFree).toBe(true);
  });

  it('is NOT free when plan is "pro"', () => {
    expect(getReferralRewardInfo('pro', null).isFree).toBe(false);
  });

  it('is NOT free when plan is "enterprise"', () => {
    expect(getReferralRewardInfo('enterprise', null).isFree).toBe(false);
  });

  // ─── baseLimit ──────────────────────────────────────────────────────────────

  it('baseLimit equals the free plan appointmentsPerMonth constant', () => {
    const { baseLimit } = getReferralRewardInfo('free', null);
    expect(baseLimit).toBe(PLAN_LIMITS.free.appointmentsPerMonth);
  });

  it('baseLimit is the same regardless of plan (always free plan base)', () => {
    expect(getReferralRewardInfo('pro', null).baseLimit).toBe(PLAN_LIMITS.free.appointmentsPerMonth);
    expect(getReferralRewardInfo('enterprise', null).baseLimit).toBe(PLAN_LIMITS.free.appointmentsPerMonth);
  });

  // ─── maxBonus ───────────────────────────────────────────────────────────────

  it('maxBonus equals MAX_BONUS_APPOINTMENTS constant', () => {
    expect(getReferralRewardInfo('free', null).maxBonus).toBe(MAX_BONUS_APPOINTMENTS);
  });

  it('maxBonus is 50', () => {
    expect(getReferralRewardInfo('free', 10).maxBonus).toBe(50);
  });

  // ─── currentBonus ───────────────────────────────────────────────────────────

  it('currentBonus is 0 when bonusLimit is null', () => {
    expect(getReferralRewardInfo('free', null).currentBonus).toBe(0);
  });

  it('currentBonus reflects the bonusLimit value', () => {
    expect(getReferralRewardInfo('free', 10).currentBonus).toBe(10);
    expect(getReferralRewardInfo('free', 50).currentBonus).toBe(50);
  });

  it('currentBonus works for paid plans too (even though UI shows different data)', () => {
    expect(getReferralRewardInfo('pro', 20).currentBonus).toBe(20);
  });

  // ─── progressPercentage — free plan ─────────────────────────────────────────

  it('progressPercentage is 0 when free with no bonus', () => {
    expect(getReferralRewardInfo('free', null).progressPercentage).toBe(0);
  });

  it('progressPercentage is 0 when free with 0 bonus', () => {
    expect(getReferralRewardInfo('free', 0).progressPercentage).toBe(0);
  });

  it('progressPercentage is 20 when free with 10 bonus (10/50)', () => {
    expect(getReferralRewardInfo('free', 10).progressPercentage).toBe(20);
  });

  it('progressPercentage is 50 when free with 25 bonus (25/50)', () => {
    expect(getReferralRewardInfo('free', 25).progressPercentage).toBe(50);
  });

  it('progressPercentage is 100 when free with 50 bonus (at cap)', () => {
    expect(getReferralRewardInfo('free', 50).progressPercentage).toBe(100);
  });

  it('progressPercentage is capped at 100 when bonus exceeds max', () => {
    expect(getReferralRewardInfo('free', 999).progressPercentage).toBe(100);
  });

  // ─── progressPercentage — paid plans ────────────────────────────────────────

  it('progressPercentage is always 100 for pro plan', () => {
    expect(getReferralRewardInfo('pro', null).progressPercentage).toBe(100);
    expect(getReferralRewardInfo('pro', 0).progressPercentage).toBe(100);
  });

  it('progressPercentage is always 100 for enterprise plan', () => {
    expect(getReferralRewardInfo('enterprise', null).progressPercentage).toBe(100);
  });

  // ─── Shape completeness ──────────────────────────────────────────────────────

  it('returns all required fields', () => {
    const result = getReferralRewardInfo('free', 10);
    expect(result).toHaveProperty('isFree');
    expect(result).toHaveProperty('currentBonus');
    expect(result).toHaveProperty('baseLimit');
    expect(result).toHaveProperty('maxBonus');
    expect(result).toHaveProperty('progressPercentage');
  });

  it('progressPercentage is always between 0 and 100 for any input', () => {
    const cases: Array<[string | null, number | null]> = [
      ['free', null], ['free', 0], ['free', 25], ['free', 50], ['free', 100],
      ['pro', null], ['enterprise', 5], [null, null],
    ];
    for (const [plan, bonus] of cases) {
      const { progressPercentage } = getReferralRewardInfo(plan, bonus);
      expect(progressPercentage).toBeGreaterThanOrEqual(0);
      expect(progressPercentage).toBeLessThanOrEqual(100);
    }
  });
});
