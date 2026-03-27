/**
 * Finances Use Case — Pure business logic for financial calculations.
 *
 * NO framework dependencies.
 *
 * Exposes:
 *  - calculateClientDebt:     compute total debt from appointment + transaction data
 *  - calculateAppointmentDebt: compute debt for a single appointment
 */

interface AppointmentWithPayment {
  start_at: string
  status: string | null
  service: { price: number } | null
  transactions: Array<{ net_amount: number }>
}

/**
 * Calculates total unpaid debt for a client from their appointment history.
 * Only counts past appointments that are not cancelled/no_show.
 *
 * Pure function — no side effects, no DB calls.
 */
export function calculateClientDebt(
  appointments: AppointmentWithPayment[]
): number {
  const now = new Date()
  let totalDebt = 0

  for (const apt of appointments) {
    if (apt.status === 'cancelled' || apt.status === 'no_show') continue

    const startDate = new Date(apt.start_at)
    if (isNaN(startDate.getTime())) continue

    if (startDate >= now) continue

    const debt = calculateAppointmentDebt(apt)
    if (debt > 0) totalDebt += debt
  }

  return totalDebt
}

/**
 * Calculates remaining debt for a single appointment.
 * Returns positive number if client owes money, 0 if paid.
 */
export function calculateAppointmentDebt(apt: AppointmentWithPayment): number {
  const price = Number(apt.service?.price ?? 0)
  if (!isFinite(price) || price <= 0) return 0

  const paid = apt.transactions?.reduce(
    (sum, t) => {
      const amount = Number(t.net_amount ?? 0)
      return sum + (isFinite(amount) ? amount : 0)
    },
    0,
  ) ?? 0

  return Math.max(0, price - paid)
}
