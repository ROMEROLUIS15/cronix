// Double-booking validation logic — pure business logic, no framework deps
import type { DoubleBookingLevel, DoubleBookingCheckResult } from '@/types'

interface DaySlot {
  time: string
  service: string
}

interface BookingCheckParams {
  existingCount: number
  existingSlots: DaySlot[]
}

export const DoubleBookingWarningLevel = {
  ALLOWED: 'allowed' as DoubleBookingLevel,
  WARN:    'warn'    as DoubleBookingLevel,
  BLOCKED: 'blocked' as DoubleBookingLevel,
} as const

export function evaluateDoubleBooking(
  params: BookingCheckParams
): DoubleBookingCheckResult {
  const { existingCount, existingSlots } = params

  if (existingCount === 0) {
    return {
      level: 'allowed',
      existingCount: 0,
      existingSlots: [],
      message: '',
    }
  }

  if (existingCount === 1) {
    const slot = existingSlots[0]
    return {
      level: 'warn',
      existingCount: 1,
      existingSlots,
      message: `Este cliente ya tiene 1 cita ese día${slot ? ` (${slot.time} — ${slot.service})` : ''}. ¿Agregar una segunda cita?`,
    }
  }

  return {
    level: 'blocked',
    existingCount,
    existingSlots,
    message: `Este cliente ya tiene ${existingCount} citas ese día. Límite de doble agenda alcanzado.`,
  }
}
