/**
 * Central plan limits — single source of truth for all enforcement points.
 * Update here and all guards (AI tool, server action, UI) update automatically.
 */

export const PLAN_LIMITS = {
  free: {
    clients:        20,
    employees:      1,
    appointmentsPerMonth: 30,
  },
  pro: {
    clients:        Infinity,
    employees:      2,
    appointmentsPerMonth: 150,
  },
  enterprise: {
    clients:        Infinity,
    employees:      Infinity,
    appointmentsPerMonth: Infinity,
  },
} as const

export type PlanKey = keyof typeof PLAN_LIMITS

export function getClientLimit(plan: string): number {
  return PLAN_LIMITS[plan as PlanKey]?.clients ?? PLAN_LIMITS.free.clients
}

export function getEmployeeLimit(plan: string): number {
  return PLAN_LIMITS[plan as PlanKey]?.employees ?? PLAN_LIMITS.free.employees
}

export function getAppointmentMonthLimit(plan: string): number {
  return PLAN_LIMITS[plan as PlanKey]?.appointmentsPerMonth ?? PLAN_LIMITS.free.appointmentsPerMonth
}

export function canAccessReports(plan: string): boolean {
  return plan === 'pro' || plan === 'enterprise'
}

export function isFreePlan(plan: string): boolean {
  return plan === 'free'
}
