/**
 * GetAvailableSlotsUseCase.ts
 *
 * Calculates free time slots for a given day by subtracting booked intervals
 * from the business working hours.
 *
 * Returns slots as "HH:mm" strings spaced by `slotIntervalMin` (default 30 min).
 * A slot is available if its entire duration fits before the next booking starts.
 *
 * Depends only on IAppointmentQueryRepository — no Supabase, no HTTP.
 */

import type { IAppointmentQueryRepository } from '@/lib/domain/repositories'
import { ok, fail, type Result } from '@/types/result'

export interface GetAvailableSlotsInput {
  businessId:      string
  date:            string   // YYYY-MM-DD
  durationMin:     number   // How long the service takes
  workingHours?:   { open: string; close: string } | null
  slotIntervalMin: number   // Granularity (default 30)
}

export interface AvailableSlot {
  time:  string  // HH:mm 24h
  label: string  // "9:00 am", "2:30 pm" — for TTS/display
}

export class GetAvailableSlotsUseCase {
  constructor(private queryRepo: IAppointmentQueryRepository) {}

  async execute(input: GetAvailableSlotsInput): Promise<Result<AvailableSlot[]>> {
    const { businessId, date, durationMin, workingHours, slotIntervalMin } = input

    // Default hours if business hasn't configured schedule
    const open  = workingHours?.open  ?? '09:00'
    const close = workingHours?.close ?? '18:00'

    const dayStart = `${date}T${open}:00`
    const dayEnd   = `${date}T${close}:00`

    const bookedRes = await this.queryRepo.getDaySlots(businessId, dayStart, dayEnd)
    if (bookedRes.error) {
      return fail('No se pudo consultar la disponibilidad.')
    }

    const booked = (bookedRes.data ?? []).map((s) => ({
      start: new Date(s.start_at).getTime(),
      end:   new Date(s.end_at).getTime(),
    }))

    const slots: AvailableSlot[] = []
    const interval  = slotIntervalMin * 60_000
    const duration  = durationMin * 60_000
    const endMs     = new Date(dayEnd).getTime()
    let   cursor    = new Date(dayStart).getTime()

    while (cursor + duration <= endMs) {
      const slotEnd = cursor + duration
      const conflicts = booked.some((b) => cursor < b.end && slotEnd > b.start)

      if (!conflicts) {
        const h = Math.floor((cursor - new Date(`${date}T00:00:00`).getTime()) / 3_600_000)
        const m = Math.floor(((cursor - new Date(`${date}T00:00:00`).getTime()) % 3_600_000) / 60_000)
        const hhmm  = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        const ampm  = h < 12 ? 'am' : 'pm'
        const h12   = h === 0 ? 12 : h > 12 ? h - 12 : h
        const label = `${h12}:${String(m).padStart(2, '0')} ${ampm}`
        slots.push({ time: hhmm, label })
      }

      cursor += interval
    }

    return ok(slots)
  }
}
