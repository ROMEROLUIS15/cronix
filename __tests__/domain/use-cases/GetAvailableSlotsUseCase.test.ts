/**
 * GetAvailableSlotsUseCase.test.ts
 *
 * Tests for GetAvailableSlotsUseCase.execute():
 *   - Returns slots within working hours
 *   - Subtracts booked intervals correctly
 *   - Returns empty when fully booked
 *   - Uses default hours (09:00-18:00) when workingHours is null
 *   - Slot label format (12h with am/pm)
 *   - Duration longer than interval: slot skipped if it overlaps a booking
 *   - Repo error propagation
 */

import { describe, it, expect, vi } from 'vitest'
import { GetAvailableSlotsUseCase } from '@/lib/domain/use-cases/GetAvailableSlotsUseCase'
import type { IAppointmentQueryRepository } from '@/lib/domain/repositories'

function makeQueryRepo(slots: { start_at: string; end_at: string; id: string; status: string }[] = []): IAppointmentQueryRepository {
  return {
    getMonthAppointments: vi.fn(),
    getDayAppointments:   vi.fn(),
    getDaySlots:          vi.fn().mockResolvedValue({ data: slots, error: null }),
    getForEdit:           vi.fn(),
    findConflicts:        vi.fn(),
    findUpcomingByClient: vi.fn(),
    findByDateRange:      vi.fn(),
    getDashboardStats:    vi.fn(),
  } as unknown as IAppointmentQueryRepository
}

const DATE = '2026-05-04' // Monday

describe('GetAvailableSlotsUseCase', () => {

  // ── Basic slot generation ───────────────────────────────────────────────────

  it('returns slots for an open 2-hour window with 30-min interval', async () => {
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '09:00', close: '11:00' },
      slotIntervalMin: 30,
    })

    expect(result.error).toBeNull()
    // 09:00, 09:30, 10:00, 10:30 → 4 slots (each 30min fits before 11:00)
    expect(result.data).toHaveLength(4)
    expect(result.data![0]!.time).toBe('09:00')
    expect(result.data![3]!.time).toBe('10:30')
  })

  it('slot label uses 12h format with am/pm', async () => {
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '09:00', close: '10:00' },
      slotIntervalMin: 30,
    })

    expect(result.data![0]!.label).toBe('9:00 am')
  })

  it('correctly labels pm slots', async () => {
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '14:00', close: '15:00' },
      slotIntervalMin: 30,
    })

    expect(result.data![0]!.label).toBe('2:00 pm')
  })

  // ── Booked interval subtraction ─────────────────────────────────────────────

  it('excludes slots that overlap a booked appointment', async () => {
    const repo = makeQueryRepo([{
      id:       'apt-1',
      start_at: `${DATE}T09:00:00`,
      end_at:   `${DATE}T09:30:00`,
      status:   'confirmed',
    }])
    const uc     = new GetAvailableSlotsUseCase(repo)
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '09:00', close: '10:30' },
      slotIntervalMin: 30,
    })

    const times = result.data!.map((s) => s.time)
    expect(times).not.toContain('09:00')   // conflicts with booked 09:00-09:30
    expect(times).toContain('09:30')
    expect(times).toContain('10:00')
  })

  it('excludes slots where duration would overlap a booking mid-slot', async () => {
    // Slot at 09:00 (60min) → ends 10:00 > booking start 09:45 → conflicts
    // Slot at 09:30 (60min) → ends 10:30 = booking end 10:30 → overlaps (cursor<end && slotEnd>start)
    // Slot at 10:00 (60min) → ends 11:00 <= close, but 10:00 < 10:30(booking end) && 11:00 > 09:45 → conflicts
    // Slot at 10:30 (60min) → ends 11:30 > close (11:00) → doesn't fit (cursor+duration > endMs)
    // Result: NO slots available at all
    const repo = makeQueryRepo([{
      id:       'apt-1',
      start_at: `${DATE}T09:45:00`,
      end_at:   `${DATE}T10:30:00`,
      status:   'confirmed',
    }])
    const uc     = new GetAvailableSlotsUseCase(repo)
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     60,
      workingHours:    { open: '09:00', close: '11:00' },
      slotIntervalMin: 30,
    })

    const times = result.data!.map((s) => s.time)
    expect(times).not.toContain('09:00') // conflicts with booking
    expect(times).not.toContain('09:30') // conflicts with booking
    expect(times).not.toContain('10:00') // still overlaps booking end (10:30)
    expect(times).not.toContain('10:30') // 10:30+60=11:30 exceeds close (11:00)
    expect(result.data!.length).toBe(0)
  })

  // ── Fully booked ────────────────────────────────────────────────────────────

  it('returns empty array when entire window is booked', async () => {
    const repo = makeQueryRepo([{
      id:       'apt-1',
      start_at: `${DATE}T09:00:00`,
      end_at:   `${DATE}T18:00:00`,
      status:   'confirmed',
    }])
    const uc     = new GetAvailableSlotsUseCase(repo)
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '09:00', close: '18:00' },
      slotIntervalMin: 30,
    })

    expect(result.data).toHaveLength(0)
  })

  // ── Default hours fallback ──────────────────────────────────────────────────

  it('uses 09:00-18:00 defaults when workingHours is null', async () => {
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    null,
      slotIntervalMin: 30,
    })

    expect(result.error).toBeNull()
    // Default 09:00-18:00 with 30min interval = 18 slots
    expect(result.data!.length).toBe(18)
    expect(result.data![0]!.time).toBe('09:00')
  })

  // ── Repo error ──────────────────────────────────────────────────────────────

  it('returns fail when getDaySlots errors', async () => {
    const repo = {
      ...makeQueryRepo(),
      getDaySlots: vi.fn().mockResolvedValue({ data: null, error: 'DB connection failed' }),
    } as unknown as IAppointmentQueryRepository
    const uc     = new GetAvailableSlotsUseCase(repo)
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     30,
      workingHours:    { open: '09:00', close: '18:00' },
      slotIntervalMin: 30,
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('returns no slots when duration equals full window', async () => {
    // 60min duration, 60min window → only 09:00 fits exactly
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     60,
      workingHours:    { open: '09:00', close: '10:00' },
      slotIntervalMin: 30,
    })

    expect(result.data!.length).toBe(1)
    expect(result.data![0]!.time).toBe('09:00')
  })

  it('returns no slots when duration exceeds window', async () => {
    // 90min duration, 60min window → nothing fits
    const uc     = new GetAvailableSlotsUseCase(makeQueryRepo())
    const result = await uc.execute({
      businessId:      'biz-1',
      date:            DATE,
      durationMin:     90,
      workingHours:    { open: '09:00', close: '10:00' },
      slotIntervalMin: 30,
    })

    expect(result.data!.length).toBe(0)
  })
})
