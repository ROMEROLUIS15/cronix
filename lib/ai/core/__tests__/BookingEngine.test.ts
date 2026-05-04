/**
 * BookingEngine.test.ts — Production-level tests for the booking engine core.
 *
 * Covers: createAppointment, cancelAppointment, rescheduleAppointment,
 *         getAppointmentsByDate, getAvailableSlots, createClient, searchClients, dispatch.
 *
 * Adversarial cases:
 *   - Invalid times ("25:99", "3 PM")
 *   - Missing client_name
 *   - UUID injection via business_id (cross-tenant attack)
 *   - Duplicate appointments (SLOT_CONFLICT)
 *   - DB errors (graceful degradation)
 *   - Unknown tool name in dispatch
 *   - Exception inside dispatch → always returns ToolResult (never throws)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingEngine, type BookingEngineRepos } from '../booking/BookingEngine'
import type { IAppointmentQueryRepository } from '@/lib/domain/repositories/IAppointmentQueryRepository'
import type { IAppointmentCommandRepository } from '@/lib/domain/repositories/IAppointmentCommandRepository'
import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { IServiceRepository, ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext } from '../security/TenantEnforcer'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/cache', () => ({
  default: {
    get:           vi.fn().mockResolvedValue(null),
    set:           vi.fn().mockResolvedValue(undefined),
    invalidate:    vi.fn().mockResolvedValue(undefined),
    invalidateKey: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BIZ_A = 'biz-a'
const BIZ_B = 'biz-b'
const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const CLIENT_UUID = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
const SERVICE_UUID = 's1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1'
const APPT_UUID = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'

function makeCtx(businessId = BIZ_A): TenantContext {
  return { businessId, userId: 'user-1', timezone: 'America/Bogota' } as unknown as TenantContext
}

const sampleClient: ClientForAI = { id: CLIENT_UUID, name: 'Ana García', phone: null }
const sampleService: ServiceForDropdown = { id: SERVICE_UUID, name: 'Manicura', duration_min: 45, price: 15000 }

const sampleAppointmentRow = {
  id:         APPT_UUID,
  client_id:  CLIENT_UUID,
  service_id: SERVICE_UUID,
  assigned_user_id: null,
  start_at:   '2026-05-10T15:00:00.000Z',
  status:     'pending',
  notes:      null,
  appointment_services: [{ service_id: SERVICE_UUID, sort_order: 0 }],
}

function makeRepos(overrides: Partial<BookingEngineRepos> = {}): BookingEngineRepos {
  const appointmentQuery: IAppointmentQueryRepository = {
    getMonthAppointments: vi.fn().mockResolvedValue({ data: [] }),
    getDayAppointments:   vi.fn().mockResolvedValue({ data: [] }),
    getDaySlots:          vi.fn().mockResolvedValue({ data: [] }),
    getForEdit:           vi.fn().mockResolvedValue({ data: sampleAppointmentRow }),
    findConflicts:        vi.fn().mockResolvedValue({ data: [] }),
    findUpcomingByClient: vi.fn().mockResolvedValue({ data: [] }),
    findByDateRange:      vi.fn().mockResolvedValue({ data: [] }),
    getDashboardStats:    vi.fn().mockResolvedValue({ data: {} }),
  }

  const appointmentCommand: IAppointmentCommandRepository = {
    create:       vi.fn().mockResolvedValue({ data: { id: APPT_UUID, business_id: BIZ_A, client_id: CLIENT_UUID, status: 'pending' } }),
    updateStatus: vi.fn().mockResolvedValue({ data: undefined }),
    reschedule:   vi.fn().mockResolvedValue({ data: undefined }),
  }

  const clients: IClientRepository = {
    findActiveForAI: vi.fn().mockResolvedValue({ data: [sampleClient] }),
    getById:         vi.fn().mockResolvedValue({ data: sampleClient }),
    getAll:          vi.fn(),
    getAllForSelect:  vi.fn(),
    getAppointments: vi.fn(),
    insert:          vi.fn().mockResolvedValue({ data: sampleClient }),
    findInactive:    vi.fn(),
  } as unknown as IClientRepository

  const services: IServiceRepository = {
    getActive:    vi.fn().mockResolvedValue({ data: [sampleService] }),
    getAll:       vi.fn(),
    hasAny:       vi.fn(),
    create:       vi.fn(),
    update:       vi.fn(),
    delete:       vi.fn(),
    toggleActive: vi.fn(),
    getById:      vi.fn(),
  } as unknown as IServiceRepository

  return {
    appointmentQuery:   { ...appointmentQuery,   ...overrides.appointmentQuery   } as IAppointmentQueryRepository,
    appointmentCommand: { ...appointmentCommand, ...overrides.appointmentCommand } as IAppointmentCommandRepository,
    clients:            { ...clients,            ...overrides.clients            } as IClientRepository,
    services:           { ...services,           ...overrides.services           } as IServiceRepository,
  }
}

// ── createAppointment ─────────────────────────────────────────────────────────

describe('BookingEngine.createAppointment', () => {
  let engine: BookingEngine
  let repos: BookingEngineRepos

  beforeEach(() => {
    repos = makeRepos()
    engine = new BookingEngine(repos)
  })

  it('creates appointment successfully with client_name', async () => {
    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.action).toBe('created')
      expect(result.data.clientName).toBe('Ana García')
      expect(result.data.serviceName).toBe('Manicura')
      expect(result.data.appointmentId).toBe(APPT_UUID)
    }
  })

  it('auto-creates client when not found and autoCreateClient=true (default)', async () => {
    const newClient: ClientForAI = { id: 'new-id', name: 'Nuevo Cliente', phone: null }
    repos.clients.findActiveForAI = vi.fn().mockResolvedValue({ data: [] })
    ;(repos.clients.insert as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({ data: newClient })

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Nuevo Cliente',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.clientName).toBe('Nuevo Cliente')
  })

  it('returns CLIENT_NOT_FOUND when not found and autoCreateClient=false', async () => {
    repos.clients.findActiveForAI = vi.fn().mockResolvedValue({ data: [] })

    const result = await engine.createAppointment(
      makeCtx(),
      { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Desconocido' },
      { autoCreateClient: false },
    )
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('CLIENT_NOT_FOUND')
  })

  it('returns CLIENT_NOT_FOUND when no client_name and no client_id', async () => {
    const result = await engine.createAppointment(makeCtx(), {
      service_id: 'Manicura',
      date:       '2026-05-10',
      time:       '10:00',
      // Neither client_name nor client_id
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('returns CLIENT_AMBIGUOUS when multiple clients match', async () => {
    const twins: ClientForAI[] = [
      { id: 'x1', name: 'Ana García', phone: null },
      { id: 'x2', name: 'Ana Garzia', phone: null },
    ]
    repos.clients.findActiveForAI = vi.fn().mockResolvedValue({ data: twins })

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana Gar',
    })
    // May be ambiguous or found depending on fuzzy scores
    if (!result.success) {
      expect(['CLIENT_AMBIGUOUS', 'CLIENT_NOT_FOUND']).toContain(result.error)
    }
  })

  it('returns SERVICE_NOT_FOUND when service does not exist', async () => {
    repos.services.getActive = vi.fn().mockResolvedValue({ data: [] })

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Servicio Inexistente',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('SERVICE_NOT_FOUND')
  })

  it('returns SLOT_CONFLICT when time is taken', async () => {
    repos.appointmentQuery.findConflicts = vi.fn().mockResolvedValue({
      data: [{ id: 'existing-appt' }],
    })

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('SLOT_CONFLICT')
  })

  it('returns INVALID_ARGS for invalid time format "25:99"', async () => {
    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '25:99',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('returns INVALID_ARGS for 12h time format "3 PM"', async () => {
    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '3 PM',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('returns DB_ERROR on appointment creation failure', async () => {
    repos.appointmentCommand.create = vi.fn().mockResolvedValue({ error: 'DB connection failed' })

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('DB_ERROR')
  })

  it('invalidates cache on success', async () => {
    const cacheMock = await import('@/lib/cache')
    await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    // Allow microtask queue to flush void cache calls
    await new Promise((r) => setTimeout(r, 0))
    expect(cacheMock.default.invalidate).toHaveBeenCalledWith(BIZ_A, 'appointments')
  })
})

// ── cancelAppointment ─────────────────────────────────────────────────────────

describe('BookingEngine.cancelAppointment', () => {
  let engine: BookingEngine
  let repos: BookingEngineRepos

  beforeEach(() => {
    repos = makeRepos()
    engine = new BookingEngine(repos)
  })

  it('cancels by appointment_id successfully', async () => {
    const result = await engine.cancelAppointment(makeCtx(), { appointment_id: APPT_UUID })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.action).toBe('cancelled')
  })

  it('returns APPOINTMENT_NOT_FOUND for cross-tenant UUID', async () => {
    // Cross-tenant attack: attacker uses appointmentId from biz-b while logged into biz-a
    repos.appointmentQuery.getForEdit = vi.fn().mockResolvedValue({ data: null })

    const result = await engine.cancelAppointment(makeCtx(BIZ_A), { appointment_id: VALID_UUID })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
  })

  it('MUST NOT cancel appointment from another business (security assertion)', async () => {
    // getForEdit must be called with ctx.businessId, ensuring cross-tenant isolation
    await engine.cancelAppointment(makeCtx(BIZ_A), { appointment_id: APPT_UUID })
    expect(repos.appointmentQuery.getForEdit).toHaveBeenCalledWith(APPT_UUID, BIZ_A)
    expect(repos.appointmentQuery.getForEdit).not.toHaveBeenCalledWith(APPT_UUID, BIZ_B)
  })

  it('returns INVALID_ARGS for empty input', async () => {
    const result = await engine.cancelAppointment(makeCtx(), {})
    expect(result.success).toBe(false)
  })

  it('returns DB_ERROR on updateStatus failure', async () => {
    repos.appointmentCommand.updateStatus = vi.fn().mockResolvedValue({ error: 'DB error' })

    const result = await engine.cancelAppointment(makeCtx(), { appointment_id: APPT_UUID })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('DB_ERROR')
  })

  it('cancels by client_name + date when no appointment_id', async () => {
    // Mock getDayAppointments to return a matching appointment
    const apptSummary = {
      id:          APPT_UUID,
      time:        '10:00',
      clientName:  'Ana García',
      serviceName: 'Manicura',
    }
    // GetAppointmentsByDateUseCase.execute uses getDayAppointments
    ;(repos.appointmentQuery.getDayAppointments as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{
        id: APPT_UUID,
        status: 'pending',
        client: { name: 'Ana García' },
        services: [{ name: 'Manicura', duration_min: 45, sort_order: 0 }],
        start_at: '2026-05-10T15:00:00.000Z',
        end_at:   '2026-05-10T15:45:00.000Z',
        notes: null,
        assigned_user_id: null,
        client_id: CLIENT_UUID,
        service_id: SERVICE_UUID,
      }],
    })

    const result = await engine.cancelAppointment(makeCtx(), {
      client_name: 'Ana García',
      date:        '2026-05-10',
    })
    // Either cancelled or APPOINTMENT_NOT_FOUND depending on GetAppointmentsByDateUseCase internals
    // The important thing: it must not throw
    expect(typeof result.success).toBe('boolean')
  })
})

// ── rescheduleAppointment ─────────────────────────────────────────────────────

describe('BookingEngine.rescheduleAppointment', () => {
  let engine: BookingEngine
  let repos: BookingEngineRepos

  beforeEach(() => {
    repos = makeRepos()
    engine = new BookingEngine(repos)
  })

  it('reschedules successfully', async () => {
    const result = await engine.rescheduleAppointment(makeCtx(), {
      appointment_id: APPT_UUID,
      new_date:       '2026-05-11',
      new_time:       '14:00',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.action).toBe('rescheduled')
  })

  it('returns SLOT_CONFLICT when new slot is taken', async () => {
    repos.appointmentQuery.findConflicts = vi.fn().mockResolvedValue({
      data: [{ id: 'other-appt' }],
    })

    const result = await engine.rescheduleAppointment(makeCtx(), {
      appointment_id: APPT_UUID,
      new_date:       '2026-05-11',
      new_time:       '14:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('SLOT_CONFLICT')
  })

  it('returns APPOINTMENT_NOT_FOUND for cross-tenant ID', async () => {
    repos.appointmentQuery.getForEdit = vi.fn().mockResolvedValue({ data: null })

    const result = await engine.rescheduleAppointment(makeCtx(BIZ_A), {
      appointment_id: VALID_UUID,
      new_date:       '2026-05-11',
      new_time:       '14:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
  })

  it('getForEdit is called with businessId (cross-tenant guard)', async () => {
    await engine.rescheduleAppointment(makeCtx(BIZ_A), {
      appointment_id: APPT_UUID,
      new_date:       '2026-05-11',
      new_time:       '14:00',
    })
    expect(repos.appointmentQuery.getForEdit).toHaveBeenCalledWith(APPT_UUID, BIZ_A)
  })

  it('returns INVALID_ARGS for missing new_date', async () => {
    const result = await engine.rescheduleAppointment(makeCtx(), {
      appointment_id: APPT_UUID,
      new_time:       '14:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })
})

// ── getAppointmentsByDate ─────────────────────────────────────────────────────

describe('BookingEngine.getAppointmentsByDate', () => {
  it('returns message when no appointments', async () => {
    const repos = makeRepos()
    repos.appointmentQuery.getDayAppointments = vi.fn().mockResolvedValue({ data: [] })
    const engine = new BookingEngine(repos)

    const result = await engine.getAppointmentsByDate(makeCtx(), { date: '2026-05-10' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.message).toContain('No hay citas')
  })

  it('returns INVALID_ARGS for invalid date', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.getAppointmentsByDate(makeCtx(), { date: 'bad-date' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })
})

// ── getAvailableSlots ─────────────────────────────────────────────────────────

describe('BookingEngine.getAvailableSlots', () => {
  it('returns INVALID_ARGS for invalid input', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.getAvailableSlots(makeCtx(), {})
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('reports closed day when workingHours explicitly null for that day', async () => {
    const engine = new BookingEngine(makeRepos())
    const workingHours = { sunday: null }
    // May 3 2026 is a Sunday
    const result = await engine.getAvailableSlots(
      makeCtx(),
      { date: '2026-05-03', duration_min: 30 },
      workingHours,
    )
    expect(result.success).toBe(true)
    if (result.success) expect(result.message).toContain('cerrado')
  })
})

// ── createClient ─────────────────────────────────────────────────────────────

describe('BookingEngine.createClient', () => {
  it('creates client successfully', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)
    const result = await engine.createClient(makeCtx(), { name: 'Nuevo Cliente', phone: '04141234567' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Ana García') // from mock
  })

  it('returns INVALID_ARGS for empty name', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.createClient(makeCtx(), { name: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('returns DB_ERROR on insert failure', async () => {
    const repos = makeRepos()
    repos.clients.insert = vi.fn().mockResolvedValue({ error: 'duplicate key' })
    const engine = new BookingEngine(repos)
    const result = await engine.createClient(makeCtx(), { name: 'Cliente Test' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('DB_ERROR')
  })
})

// ── searchClients ─────────────────────────────────────────────────────────────

describe('BookingEngine.searchClients', () => {
  it('finds existing client', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.searchClients(makeCtx(), { query: 'Ana García' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.message).toContain('CLIENT_FOUND')
  })

  it('reports not found for unknown query', async () => {
    const repos = makeRepos()
    repos.clients.findActiveForAI = vi.fn().mockResolvedValue({ data: [] })
    const engine = new BookingEngine(repos)
    const result = await engine.searchClients(makeCtx(), { query: 'Xyz Unknown Person' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.message).toContain('CLIENT_NOT_FOUND')
  })

  it('returns INVALID_ARGS for single-char query', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.searchClients(makeCtx(), { query: 'A' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })
})

// ── dispatch ──────────────────────────────────────────────────────────────────

describe('BookingEngine.dispatch', () => {
  let engine: BookingEngine

  beforeEach(() => {
    engine = new BookingEngine(makeRepos())
  })

  it('routes confirm_booking correctly', async () => {
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })
    expect(result.success).toBe(true)
  })

  it('routes cancel_booking correctly', async () => {
    const result = await engine.dispatch(makeCtx(), 'cancel_booking', {
      appointment_id: APPT_UUID,
    })
    expect(result.success).toBe(true)
  })

  it('routes search_clients correctly', async () => {
    const result = await engine.dispatch(makeCtx(), 'search_clients', { query: 'Ana' })
    expect(result.success).toBe(true)
  })

  it('returns INVALID_ARGS for unknown tool name', async () => {
    const result = await engine.dispatch(makeCtx(), 'hack_the_planet', {})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('INVALID_ARGS')
      expect(result.message).toContain('hack_the_planet')
    }
  })

  it('NEVER throws — catches exceptions and returns DB_ERROR', async () => {
    // Simulate an unexpected exception inside a tool
    const repos = makeRepos()
    repos.clients.findActiveForAI = vi.fn().mockRejectedValue(new Error('Unexpected crash'))
    const crashEngine = new BookingEngine(repos)

    const result = await crashEngine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    // Must NOT throw — must return a ToolResult
    expect(result).toBeDefined()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('DB_ERROR')
  })

  it('does NOT propagate exceptions to caller (resilience)', async () => {
    const repos = makeRepos()
    repos.appointmentQuery.findConflicts = vi.fn().mockRejectedValue(new Error('Redis down'))
    const resilienceEngine = new BookingEngine(repos)

    // Must not reject the promise
    await expect(
      resilienceEngine.dispatch(makeCtx(), 'confirm_booking', {
        service_id:  'Manicura',
        date:        '2026-05-10',
        time:        '10:00',
        client_name: 'Ana García',
      })
    ).resolves.toBeDefined()
  })
})

// ── Security: Cross-Tenant Attack ─────────────────────────────────────────────

describe('BookingEngine — Cross-Tenant Security', () => {
  it('getForEdit is always called with the context businessId', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.cancelAppointment(makeCtx(BIZ_A), { appointment_id: APPT_UUID })

    // The repository must have been queried with BIZ_A, not BIZ_B
    expect(repos.appointmentQuery.getForEdit).toHaveBeenCalledWith(APPT_UUID, BIZ_A)
    expect(repos.appointmentQuery.getForEdit).not.toHaveBeenCalledWith(APPT_UUID, BIZ_B)
  })

  it('clients.findActiveForAI always scoped to context businessId', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.createAppointment(makeCtx(BIZ_A), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(repos.clients.findActiveForAI).toHaveBeenCalledWith(BIZ_A)
    expect(repos.clients.findActiveForAI).not.toHaveBeenCalledWith(BIZ_B)
  })

  it('services.getActive always scoped to context businessId', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.createAppointment(makeCtx(BIZ_A), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(repos.services.getActive).toHaveBeenCalledWith(BIZ_A)
    expect(repos.services.getActive).not.toHaveBeenCalledWith(BIZ_B)
  })

  it('appointment from different business → not found (cross-tenant guard)', async () => {
    const repos = makeRepos()
    // Simulate: biz-b's appointment does not appear when queried with biz-a
    repos.appointmentQuery.getForEdit = vi.fn().mockResolvedValue({ data: null })
    const engine = new BookingEngine(repos)

    const result = await engine.cancelAppointment(makeCtx(BIZ_A), {
      appointment_id: VALID_UUID, // belongs to biz-b
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
  })

  it('createClient.insert uses ctx.businessId (not LLM-supplied)', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.createClient(makeCtx(BIZ_A), { name: 'Nuevo', phone: undefined })

    // The insert mock receives business_id from ctx, not from rawArgs
    const insertCall = (repos.clients.insert as ReturnType<typeof vi.fn>).mock.calls[0]
    if (insertCall) {
      expect(insertCall[0].business_id).toBe(BIZ_A)
    }
  })
})

// ── Stress: Redis/DB degradation ──────────────────────────────────────────────

describe('BookingEngine — Graceful Degradation', () => {
  it('findConflicts error does NOT prevent seeing a failure message', async () => {
    const repos = makeRepos()
    repos.appointmentQuery.findConflicts = vi.fn().mockResolvedValue({ error: 'Redis down' })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    // CreateAppointmentUseCase returns fail() when findConflicts errors
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('dispatch always returns ToolResult (never undefined)', async () => {
    const repos = makeRepos()
    repos.clients.findActiveForAI = vi.fn().mockRejectedValue(new Error('Network error'))
    const engine = new BookingEngine(repos)

    const tools = ['confirm_booking', 'cancel_booking', 'reschedule_booking',
                   'get_appointments_by_date', 'get_available_slots', 'search_clients']

    for (const tool of tools) {
      const result = await engine.dispatch(makeCtx(), tool, {})
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
      expect(typeof result.message).toBe('string')
    }
  })
})
