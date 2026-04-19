import { describe, it, expect, vi } from 'vitest'
import { CreateAppointmentUseCase } from '@/lib/domain/use-cases/CreateAppointmentUseCase'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'

const START = '2026-04-18T10:00:00-05:00'
const END   = '2026-04-18T10:30:00-05:00'

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
    create: vi.fn().mockResolvedValue({
      data: { id: 'appt-uuid', business_id: 'biz-1', client_id: 'cli-1', status: 'pending' },
      error: null,
    }),
    updateStatus: vi.fn(),
    reschedule:   vi.fn(),
    ...overrides,
  } as unknown as IAppointmentCommandRepository
}

describe('CreateAppointmentUseCase', () => {

  it('returns appointment id and status on success', async () => {
    const uc = new CreateAppointmentUseCase(makeQueryRepo(), makeCommandRepo())
    const result = await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe('appt-uuid')
    expect(result.data?.status).toBe('pending')
  })

  it('calls create with correct payload shape', async () => {
    const query   = makeQueryRepo()
    const command = makeCommandRepo()
    const uc = new CreateAppointmentUseCase(query, command)

    await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1', 'svc-2'],
      startAt: START, endAt: END, notes: 'bring invoice',
    })

    expect(command.create).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id:  'biz-1',
        client_id:    'cli-1',
        service_ids:  ['svc-1', 'svc-2'],
        start_at:     START,
        end_at:       END,
        notes:        'bring invoice',
        status:       'pending',
      })
    )
  })

  it('fails when slot is already occupied', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'appt-conflict' }], error: null }),
    })
    const uc = new CreateAppointmentUseCase(query, makeCommandRepo())
    const result = await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('fails when conflict check returns error', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: null, error: 'DB timeout' }),
    })
    const uc = new CreateAppointmentUseCase(query, makeCommandRepo())
    const result = await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('fails when command repo returns an error', async () => {
    const command = makeCommandRepo({
      create: vi.fn().mockResolvedValue({ data: null, error: 'FK violation' }),
    })
    const uc = new CreateAppointmentUseCase(makeQueryRepo(), command)
    const result = await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('fails when command repo returns null data without error', async () => {
    const command = makeCommandRepo({
      create: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const uc = new CreateAppointmentUseCase(makeQueryRepo(), command)
    const result = await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(result.error).toBeTruthy()
  })

  it('does not call create when conflict is detected', async () => {
    const query = makeQueryRepo({
      findConflicts: vi.fn().mockResolvedValue({ data: [{ id: 'conflict' }], error: null }),
    })
    const command = makeCommandRepo()
    const uc = new CreateAppointmentUseCase(query, command)

    await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END,
    })

    expect(command.create).not.toHaveBeenCalled()
  })

  it('passes assignedUserId when provided', async () => {
    const command = makeCommandRepo()
    const uc = new CreateAppointmentUseCase(makeQueryRepo(), command)

    await uc.execute({
      businessId: 'biz-1', clientId: 'cli-1', serviceIds: ['svc-1'],
      startAt: START, endAt: END, assignedUserId: 'user-42',
    })

    expect(command.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_user_id: 'user-42' })
    )
  })
})
