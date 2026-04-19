import { describe, it, expect, vi } from 'vitest'
import { RescheduleAppointmentUseCase } from '@/lib/domain/use-cases/RescheduleAppointmentUseCase'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'

const NEW_START = '2026-04-19T11:00:00-05:00'
const NEW_END   = '2026-04-19T11:30:00-05:00'
const APPT_ID   = 'appt-abc'
const BIZ_ID    = 'biz-1'

function makeQueryRepo(overrides: Partial<IAppointmentQueryRepository> = {}): IAppointmentQueryRepository {
  return {
    getMonthAppointments:  vi.fn(),
    getDayAppointments:    vi.fn(),
    getDaySlots:           vi.fn(),
    getForEdit:            vi.fn(),
    findConflicts:         vi.fn().mockResolvedValue({ data: [], error: null }),
    findUpcomingByClient:  vi.fn(),
    findByDateRange:       vi.fn(),
    getDashboardStats:     vi.fn(),
    ...overrides,
  } as unknown as IAppointmentQueryRepository
}

function makeCommandRepo(overrides: Partial<IAppointmentCommandRepository> = {}): IAppointmentCommandRepository {
  return {
    create:       vi.fn(),
    updateStatus: vi.fn(),
    reschedule:   vi.fn().mockResolvedValue({ data: undefined, error: null }),
    ...overrides,
  } as unknown as IAppointmentCommandRepository
}

describe('RescheduleAppointmentUseCase', () => {

  it('succeeds when new slot is free', async () => {
    const uc     = new RescheduleAppointmentUseCase(makeQueryRepo(), makeCommandRepo())
    const result = await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(result.error).toBeNull()
  })

  it('excludes the rescheduled appointment from conflict check', async () => {
    const query  = makeQueryRepo()
    const uc     = new RescheduleAppointmentUseCase(query, makeCommandRepo())
    await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(query.findConflicts).toHaveBeenCalledWith(BIZ_ID, NEW_START, NEW_END, APPT_ID)
  })

  it('calls reschedule with correct args', async () => {
    const command = makeCommandRepo()
    const uc      = new RescheduleAppointmentUseCase(makeQueryRepo(), command)
    await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(command.reschedule).toHaveBeenCalledWith(APPT_ID, NEW_START, NEW_END, BIZ_ID)
  })

  it('fails when new slot has a conflict', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'other-appt' }], error: null }),
    })
    const uc     = new RescheduleAppointmentUseCase(query, makeCommandRepo())
    const result = await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('fails when conflict check errors out', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: null, error: 'DB error' }),
    })
    const uc     = new RescheduleAppointmentUseCase(query, makeCommandRepo())
    const result = await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(result.error).toBeTruthy()
  })

  it('does not call reschedule when conflict detected', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'conflict' }], error: null }),
    })
    const command = makeCommandRepo()
    const uc      = new RescheduleAppointmentUseCase(query, command)

    await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(command.reschedule).not.toHaveBeenCalled()
  })

  it('propagates repo reschedule error', async () => {
    const command = makeCommandRepo({
      reschedule: vi.fn().mockResolvedValue({ data: null, error: 'Appointment not found' }),
    })
    const uc     = new RescheduleAppointmentUseCase(makeQueryRepo(), command)
    const result = await uc.execute({
      businessId: BIZ_ID, appointmentId: APPT_ID,
      newStartAt: NEW_START, newEndAt: NEW_END,
    })

    expect(result.error).toBeTruthy()
  })
})
