import { describe, it, expect, vi } from 'vitest'
import { GetAppointmentsByDateUseCase } from '@/lib/domain/use-cases/GetAppointmentsByDateUseCase'
import type { IAppointmentQueryRepository } from '@/lib/domain/repositories'

function makeAppt(overrides: object = {}) {
  return {
    id: 'appt-1',
    start_at: '2026-04-18T10:00:00-05:00',
    status: 'pending',
    client: { name: 'Ana Torres' },
    service: { name: 'Corte' },
    appointment_services: [],
    ...overrides,
  }
}

function makeQueryRepo(overrides: Partial<IAppointmentQueryRepository> = {}): IAppointmentQueryRepository {
  return {
    getMonthAppointments:  vi.fn(),
    getDayAppointments:    vi.fn().mockResolvedValue({ data: [makeAppt()], error: null }),
    getDaySlots:           vi.fn(),
    getForEdit:            vi.fn(),
    findConflicts:         vi.fn(),
    findUpcomingByClient:  vi.fn(),
    findByDateRange:       vi.fn(),
    getDashboardStats:     vi.fn(),
    ...overrides,
  } as unknown as IAppointmentQueryRepository
}

describe('GetAppointmentsByDateUseCase', () => {

  it('returns summaries for active appointments', async () => {
    const uc     = new GetAppointmentsByDateUseCase(makeQueryRepo())
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].clientName).toBe('Ana Torres')
    expect(result.data?.[0].serviceName).toBe('Corte')
  })

  it('filters out cancelled appointments', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({
        data: [makeAppt({ status: 'cancelled' }), makeAppt({ id: 'appt-2', status: 'confirmed' })],
        error: null,
      }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].id).toBe('appt-2')
  })

  it('filters out no_show appointments', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({
        data: [makeAppt({ status: 'no_show' })],
        error: null,
      }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.data).toHaveLength(0)
  })

  it('returns empty array when no appointments', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(0)
  })

  it('falls back to "Cliente" when client is null', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({
        data: [makeAppt({ client: null })],
        error: null,
      }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.data?.[0].clientName).toBe('Cliente')
  })

  it('falls back to appointment_services[0] when service is null', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({
        data: [makeAppt({
          service: null,
          appointment_services: [{ service: { name: 'Manicura' } }],
        })],
        error: null,
      }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.data?.[0].serviceName).toBe('Manicura')
  })

  it('propagates repo error', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({ data: null, error: 'DB error' }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('sorts appointments by start_at ascending', async () => {
    const repo = makeQueryRepo({
      getDayAppointments: vi.fn().mockResolvedValue({
        data: [
          makeAppt({ id: 'late',  start_at: '2026-04-18T14:00:00-05:00' }),
          makeAppt({ id: 'early', start_at: '2026-04-18T09:00:00-05:00' }),
        ],
        error: null,
      }),
    })
    const uc     = new GetAppointmentsByDateUseCase(repo)
    const result = await uc.execute({ businessId: 'biz-1', date: '2026-04-18', timezone: 'America/Bogota' })

    expect(result.data?.[0].id).toBe('early')
    expect(result.data?.[1].id).toBe('late')
  })
})
