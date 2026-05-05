import { describe, it, expect } from 'vitest';
import {
  MAX_BONUS_APPOINTMENTS,
  REFERRAL_BONUS_DAYS,
  PLAN_LIMITS,
  getClientLimit,
  getEmployeeLimit,
  getAppointmentMonthLimit,
  canAccessReports,
  isFreePlan,
  type PlanKey,
} from '@/lib/plans/plan-limits';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('MAX_BONUS_APPOINTMENTS', () => {
  it('should be 50', () => {
    expect(MAX_BONUS_APPOINTMENTS).toBe(50);
  });

  it('should be a positive number', () => {
    expect(MAX_BONUS_APPOINTMENTS).toBeGreaterThan(0);
  });
});

describe('REFERRAL_BONUS_DAYS', () => {
  it('should be 30', () => {
    expect(REFERRAL_BONUS_DAYS).toBe(30);
  });

  it('should be a positive number', () => {
    expect(REFERRAL_BONUS_DAYS).toBeGreaterThan(0);
  });
});

// ─── PLAN_LIMITS structure ────────────────────────────────────────────────────

describe('PLAN_LIMITS', () => {
  const plans: PlanKey[] = ['free', 'pro', 'enterprise'];

  it('should define all three plans', () => {
    expect(Object.keys(PLAN_LIMITS)).toEqual(expect.arrayContaining(plans));
  });

  it.each(plans)('%s — should have clients, employees, and appointmentsPerMonth', (plan) => {
    expect(PLAN_LIMITS[plan]).toHaveProperty('clients');
    expect(PLAN_LIMITS[plan]).toHaveProperty('employees');
    expect(PLAN_LIMITS[plan]).toHaveProperty('appointmentsPerMonth');
  });

  it('free plan has correct limits', () => {
    expect(PLAN_LIMITS.free.clients).toBe(20);
    expect(PLAN_LIMITS.free.employees).toBe(1);
    expect(PLAN_LIMITS.free.appointmentsPerMonth).toBe(30);
  });

  it('pro plan has correct limits', () => {
    expect(PLAN_LIMITS.pro.clients).toBe(Infinity);
    expect(PLAN_LIMITS.pro.employees).toBe(2);
    expect(PLAN_LIMITS.pro.appointmentsPerMonth).toBe(150);
  });

  it('enterprise plan has unlimited everything', () => {
    expect(PLAN_LIMITS.enterprise.clients).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.employees).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.appointmentsPerMonth).toBe(Infinity);
  });

  it('limits grow as plan tier increases', () => {
    expect(PLAN_LIMITS.pro.employees).toBeGreaterThan(PLAN_LIMITS.free.employees);
    expect(PLAN_LIMITS.pro.appointmentsPerMonth).toBeGreaterThan(PLAN_LIMITS.free.appointmentsPerMonth);
  });
});

// ─── getClientLimit ───────────────────────────────────────────────────────────

describe('getClientLimit', () => {
  it('returns 20 for free plan', () => {
    expect(getClientLimit('free')).toBe(20);
  });

  it('returns Infinity for pro plan', () => {
    expect(getClientLimit('pro')).toBe(Infinity);
  });

  it('returns Infinity for enterprise plan', () => {
    expect(getClientLimit('enterprise')).toBe(Infinity);
  });

  it('falls back to free limit for unknown plan', () => {
    expect(getClientLimit('unknown')).toBe(PLAN_LIMITS.free.clients);
  });

  it('falls back to free limit for empty string', () => {
    expect(getClientLimit('')).toBe(PLAN_LIMITS.free.clients);
  });
});

// ─── getEmployeeLimit ─────────────────────────────────────────────────────────

describe('getEmployeeLimit', () => {
  it('returns 1 for free plan', () => {
    expect(getEmployeeLimit('free')).toBe(1);
  });

  it('returns 2 for pro plan', () => {
    expect(getEmployeeLimit('pro')).toBe(2);
  });

  it('returns Infinity for enterprise plan', () => {
    expect(getEmployeeLimit('enterprise')).toBe(Infinity);
  });

  it('falls back to free limit for unknown plan', () => {
    expect(getEmployeeLimit('unknown')).toBe(PLAN_LIMITS.free.employees);
  });
});

// ─── getAppointmentMonthLimit ─────────────────────────────────────────────────

describe('getAppointmentMonthLimit', () => {
  it('returns 30 for free plan with no bonus', () => {
    expect(getAppointmentMonthLimit({ plan: 'free' })).toBe(30);
  });

  it('adds bonus on top of base limit for free plan', () => {
    expect(getAppointmentMonthLimit({ plan: 'free', bonus_appointments_limit: 10 })).toBe(40);
  });

  it('adds max bonus correctly', () => {
    expect(getAppointmentMonthLimit({ plan: 'free', bonus_appointments_limit: MAX_BONUS_APPOINTMENTS })).toBe(80);
  });

  it('returns 150 for pro plan with no bonus', () => {
    expect(getAppointmentMonthLimit({ plan: 'pro' })).toBe(150);
  });

  it('adds bonus on top of pro base limit', () => {
    expect(getAppointmentMonthLimit({ plan: 'pro', bonus_appointments_limit: 20 })).toBe(170);
  });

  it('returns Infinity for enterprise plan', () => {
    expect(getAppointmentMonthLimit({ plan: 'enterprise' })).toBe(Infinity);
  });

  it('bonus on enterprise stays Infinity', () => {
    expect(getAppointmentMonthLimit({ plan: 'enterprise', bonus_appointments_limit: 50 })).toBe(Infinity);
  });

  it('treats null bonus as 0', () => {
    expect(getAppointmentMonthLimit({ plan: 'free', bonus_appointments_limit: null })).toBe(30);
  });

  it('treats undefined bonus as 0', () => {
    expect(getAppointmentMonthLimit({ plan: 'free', bonus_appointments_limit: undefined })).toBe(30);
  });

  it('falls back to free base limit for unknown plan', () => {
    expect(getAppointmentMonthLimit({ plan: 'unknown' })).toBe(30);
  });
});

// ─── canAccessReports ─────────────────────────────────────────────────────────

describe('canAccessReports', () => {
  it('returns true for pro plan', () => {
    expect(canAccessReports('pro')).toBe(true);
  });

  it('returns true for enterprise plan', () => {
    expect(canAccessReports('enterprise')).toBe(true);
  });

  it('returns false for free plan', () => {
    expect(canAccessReports('free')).toBe(false);
  });

  it('returns false for unknown plan', () => {
    expect(canAccessReports('unknown')).toBe(false);
  });
});

// ─── isFreePlan ───────────────────────────────────────────────────────────────

describe('isFreePlan', () => {
  it('returns true for free plan', () => {
    expect(isFreePlan('free')).toBe(true);
  });

  it('returns false for pro plan', () => {
    expect(isFreePlan('pro')).toBe(false);
  });

  it('returns false for enterprise plan', () => {
    expect(isFreePlan('enterprise')).toBe(false);
  });

  it('returns false for unknown string', () => {
    expect(isFreePlan('basic')).toBe(false);
  });
});
