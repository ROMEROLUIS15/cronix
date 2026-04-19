import { describe, it, expect, vi } from 'vitest'
import { CancelAppointmentUseCase } from '@/lib/domain/use-cases/CancelAppointmentUseCase'
import type { IAppointmentCommandRepository } from '@/lib/domain/repositories'

function makeCommandRepo(overrides: Partial<IAppointmentCommandRepository> = {}): IAppointmentCommandRepository {
  return {
    create:       vi.fn(),
    updateStatus: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    reschedule:   vi.fn(),
    ...overrides,
  } as unknown as IAppointmentCommandRepository
}

describe('CancelAppointmentUseCase', () => {

  it('succeeds and calls updateStatus with "cancelled"', async () => {
    const repo   = makeCommandRepo()
    const uc     = new CancelAppointmentUseCase(repo)
    const result = await uc.execute({ appointmentId: 'appt-1', businessId: 'biz-1' })

    expect(result.error).toBeNull()
    expect(repo.updateStatus).toHaveBeenCalledWith('appt-1', 'cancelled', 'biz-1')
  })

  it('propagates repo error', async () => {
    const repo = makeCommandRepo({
      updateStatus: vi.fn().mockResolvedValue({ data: null, error: 'Row not found' }),
    })
    const uc     = new CancelAppointmentUseCase(repo)
    const result = await uc.execute({ appointmentId: 'appt-1', businessId: 'biz-1' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('scopes cancellation to businessId (passes it to repo)', async () => {
    const repo = makeCommandRepo()
    const uc   = new CancelAppointmentUseCase(repo)
    await uc.execute({ appointmentId: 'appt-99', businessId: 'biz-xyz' })

    expect(repo.updateStatus).toHaveBeenCalledWith('appt-99', 'cancelled', 'biz-xyz')
  })

  it('does not call other repo methods', async () => {
    const repo = makeCommandRepo()
    const uc   = new CancelAppointmentUseCase(repo)
    await uc.execute({ appointmentId: 'appt-1', businessId: 'biz-1' })

    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.reschedule).not.toHaveBeenCalled()
  })
})
