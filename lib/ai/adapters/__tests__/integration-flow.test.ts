/**
 * integration-flow.test.ts — Integration tests for the full booking pipeline.
 *
 * Strategy: use a REAL BookingEngine (not mocked) but mock at the repo layer.
 * This tests the complete chain:
 *
 *   DashboardBookingAdapter.execute()
 *     → TenantEnforcer.verify() [mocked — DB call]
 *     → BookingEngine.dispatch()
 *       → Zod validation
 *       → ClientResolver → IClientRepository [mocked]
 *       → ServiceResolver → IServiceRepository [mocked]
 *       → CreateAppointmentUseCase → IAppointmentRepository [mocked]
 *     → ExecResult
 *
 * Unlike unit tests (which test one function), these tests verify that the
 * layers compose correctly and that invariants hold end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardBookingAdapter } from '../dashboard/DashboardBookingAdapter'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/cache', () => ({
  default: {
    get:           vi.fn().mockResolvedValue(null),
    set:           vi.fn().mockResolvedValue(undefined),
    invalidate:    vi.fn().mockResolvedValue(undefined),
    invalidateKey: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/ai/core/security/TenantEnforcer', () => ({
  TenantEnforcer: { verify: vi.fn() },
}))

// ── Shared repo state (re-configured per test in beforeEach) ──────────────────

const BIZ_A   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const BIZ_B   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CLI_ID  = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'
const SVC_ID  = 's1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1'
const APPT_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'

const ana: ClientForAI            = { id: CLI_ID, name: 'Ana García', phone: null }
const manicura: ServiceForDropdown = { id: SVC_ID, name: 'Manicura', duration_min: 45, price: 15000 }

const apptRow = {
  id:                   APPT_ID,
  client_id:            CLI_ID,
  service_id:           SVC_ID,
  assigned_user_id:     null,
  start_at:             '2026-05-10T15:00:00.000Z',
  status:               'pending',
  notes:                null,
  appointment_services: [{ service_id: SVC_ID, sort_order: 0 }],
}

const mockAppointments = {
  findConflicts:        vi.fn().mockResolvedValue({ data: [] }),
  create:               vi.fn().mockResolvedValue({ data: { id: APPT_ID, business_id: BIZ_A, client_id: CLI_ID, status: 'pending' } }),
  getDayAppointments:   vi.fn().mockResolvedValue({ data: [] }),
  getDaySlots:          vi.fn().mockResolvedValue({ data: [] }),
  getForEdit:           vi.fn().mockResolvedValue({ data: apptRow }),
  findUpcomingByClient: vi.fn().mockResolvedValue({ data: [] }),
  findByDateRange:      vi.fn().mockResolvedValue({ data: [] }),
  getMonthAppointments: vi.fn().mockResolvedValue({ data: [] }),
  getDashboardStats:    vi.fn().mockResolvedValue({ data: {} }),
  updateStatus:         vi.fn().mockResolvedValue({ data: undefined }),
  reschedule:           vi.fn().mockResolvedValue({ data: undefined }),
}

const mockClients = {
  findActiveForAI: vi.fn().mockResolvedValue({ data: [ana] }),
  getById:         vi.fn().mockResolvedValue({ data: ana }),
  insert:          vi.fn().mockResolvedValue({ data: ana }),
  getAll:          vi.fn(),
  getAllForSelect:  vi.fn(),
  getAppointments: vi.fn(),
  findInactive:    vi.fn(),
}

const mockServices = {
  getActive:    vi.fn().mockResolvedValue({ data: [manicura] }),
  getAll:       vi.fn(),
  hasAny:       vi.fn(),
  create:       vi.fn(),
  update:       vi.fn(),
  delete:       vi.fn(),
  toggleActive: vi.fn(),
  getById:      vi.fn(),
}

vi.mock('@/lib/repositories', () => ({
  getRepos: vi.fn(() => ({
    appointments: mockAppointments,
    clients:      mockClients,
    services:     mockServices,
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getVerifyMock() {
  const mod = await import('@/lib/ai/core/security/TenantEnforcer')
  return mod.TenantEnforcer.verify as ReturnType<typeof vi.fn>
}

function makeTenantCtx(businessId = BIZ_A) {
  return { businessId, userId: 'user-1', timezone: 'America/Bogota' }
}

const mockSupabase = {} as SupabaseClient<any>

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Integration: Full booking pipeline', () => {
  let adapter: DashboardBookingAdapter
  let mockVerify: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset mocks to defaults
    mockAppointments.findConflicts.mockResolvedValue({ data: [] })
    mockAppointments.create.mockResolvedValue({ data: { id: APPT_ID, business_id: BIZ_A, client_id: CLI_ID, status: 'pending' } })
    mockAppointments.getForEdit.mockResolvedValue({ data: apptRow })
    mockAppointments.updateStatus.mockResolvedValue({ data: undefined })
    mockAppointments.reschedule.mockResolvedValue({ data: undefined })
    mockClients.findActiveForAI.mockResolvedValue({ data: [ana] })
    mockClients.getById.mockResolvedValue({ data: ana })
    mockClients.insert.mockResolvedValue({ data: ana })
    mockServices.getActive.mockResolvedValue({ data: [manicura] })

    adapter = new DashboardBookingAdapter(mockSupabase)
    mockVerify = await getVerifyMock()
    mockVerify.mockResolvedValue(makeTenantCtx(BIZ_A))
  })

  // ── INT-1: Flujo completo de agendamiento exitoso ───────────────────────────
  it('INT-1: happy path — confirm_booking end to end', async () => {
    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana García' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    expect(result.result).toContain('Ana García')
    expect(result.data).toBeDefined()
    expect(result.data?.action).toBe('created')
    expect(result.data?.appointmentId).toBe(APPT_ID)

    // Verify the repo was called correctly
    expect(mockAppointments.findConflicts).toHaveBeenCalled()
    expect(mockAppointments.create).toHaveBeenCalled()
  })

  // ── INT-2: Booking sin client_name → debe PEDIR el dato, NO fallar con 500 ─
  it('INT-2: confirm_booking without client_name → INVALID_ARGS (asks for it gracefully)', async () => {
    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_ARGS')
    expect(result.result.length).toBeGreaterThan(0) // user-facing message

    // Ensure NO appointment was created
    expect(mockAppointments.create).not.toHaveBeenCalled()
  })

  // ── INT-3: Cross-tenant attack → blocked by TenantEnforcer ─────────────────
  it('INT-3: cross-tenant attack — businessId mismatch → unauthorized, no DB write', async () => {
    mockVerify.mockRejectedValue(new Error('UNAUTHORIZED: business_id no pertenece a este usuario'))

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana' },
      userId:     'attacker',
      businessId: BIZ_B, // attacker's business is BIZ_B, not BIZ_A
      timezone:   'UTC',
    })

    expect(result.success).toBe(false)
    expect(result.result.toLowerCase()).toContain('autorizado')

    // Absolutely no DB write
    expect(mockAppointments.create).not.toHaveBeenCalled()
    expect(mockClients.insert).not.toHaveBeenCalled()
  })

  // ── INT-4: SLOT_CONFLICT — horario ocupado ──────────────────────────────────
  it('INT-4: slot conflict → SLOT_CONFLICT returned, no double-booking written', async () => {
    mockAppointments.findConflicts.mockResolvedValue({ data: [{ id: 'existing' }] })

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana García' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('SLOT_CONFLICT')
    expect(mockAppointments.create).not.toHaveBeenCalled()
  })

  // ── INT-5: Cancelar por appointment_id ─────────────────────────────────────
  it('INT-5: cancel_booking by appointment_id → success', async () => {
    const result = await adapter.execute({
      toolName:   'cancel_booking',
      rawArgs:    { appointment_id: APPT_ID },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    expect(result.data?.action).toBe('cancelled')
    expect(mockAppointments.updateStatus).toHaveBeenCalledWith(APPT_ID, 'cancelled', BIZ_A)
  })

  // ── INT-6: Cancelar cita de otro negocio → no la encuentra ─────────────────
  it('INT-6: cancel cross-tenant appointment → APPOINTMENT_NOT_FOUND, no mutation', async () => {
    // Supabase RLS: query with BIZ_A returns null for BIZ_B appointment
    mockAppointments.getForEdit.mockResolvedValue({ data: null })

    const result = await adapter.execute({
      toolName:   'cancel_booking',
      rawArgs:    { appointment_id: APPT_ID }, // belongs to BIZ_B
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
    expect(mockAppointments.updateStatus).not.toHaveBeenCalled()
  })

  // ── INT-7: Reagendar exitosamente ───────────────────────────────────────────
  it('INT-7: reschedule_booking → success with new date/time', async () => {
    const result = await adapter.execute({
      toolName:   'reschedule_booking',
      rawArgs:    { appointment_id: APPT_ID, new_date: '2026-05-11', new_time: '14:00' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    expect(result.data?.action).toBe('rescheduled')
    expect(result.data?.date).toBe('2026-05-11')
    expect(result.data?.time).toBe('14:00')
  })

  // ── INT-8: Redis caído — booking actual no se rompe ─────────────────────────
  it('INT-8: Redis (cache) down → current booking still works', async () => {
    const { default: cache } = await import('@/lib/cache')
    ;(cache.invalidate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis ECONNREFUSED'))
    ;(cache.invalidateKey as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis ECONNREFUSED'))

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana García' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    // Cache errors should not affect the booking
    expect(result.success).toBe(true)
    expect(result.data?.action).toBe('created')
  })

  // ── INT-9: Tool inexistente → INVALID_ARGS, sin excepción ──────────────────
  it('INT-9: unknown tool → INVALID_ARGS, adapter does not throw', async () => {
    const result = await adapter.execute({
      toolName:   'delete_all_appointments',
      rawArgs:    {},
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_ARGS')
  })

  // ── INT-10: Adapter never throws — always returns ExecResult ───────────────
  it('INT-10: adapter returns ExecResult under any condition (never throws)', async () => {
    const scenarios: Array<{ name: string; setup: () => void; toolName: string; rawArgs: unknown }> = [
      {
        name: 'TenantEnforcer throws',
        setup: () => mockVerify.mockRejectedValue(new Error('UNAUTHORIZED')),
        toolName: 'confirm_booking',
        rawArgs:  {},
      },
      {
        name: 'DB throws on create',
        setup: () => mockAppointments.create.mockRejectedValue(new Error('DB crash')),
        toolName: 'confirm_booking',
        rawArgs:  { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana' },
      },
      {
        name: 'Clients repo throws',
        setup: () => mockClients.findActiveForAI.mockRejectedValue(new Error('DB crash')),
        toolName: 'search_clients',
        rawArgs:  { query: 'Ana' },
      },
    ]

    for (const scenario of scenarios) {
      vi.clearAllMocks()
      mockVerify.mockResolvedValue(makeTenantCtx(BIZ_A))
      mockClients.findActiveForAI.mockResolvedValue({ data: [ana] })
      mockServices.getActive.mockResolvedValue({ data: [manicura] })
      mockAppointments.create.mockResolvedValue({ data: { id: APPT_ID, business_id: BIZ_A, client_id: CLI_ID, status: 'pending' } })
      mockAppointments.findConflicts.mockResolvedValue({ data: [] })

      scenario.setup()

      await expect(
        adapter.execute({
          toolName:   scenario.toolName,
          rawArgs:    scenario.rawArgs,
          userId:     'user-1',
          businessId: BIZ_A,
          timezone:   'America/Bogota',
        })
      ).resolves.toMatchObject({
        success: expect.any(Boolean),
        result:  expect.any(String),
      })
    }
  })

  // ── INT-11: Observabilidad — logger es llamado en cada request ──────────────
  it('INT-11: logger.info is called for successful tool dispatch', async () => {
    const { logger } = await import('@/lib/logger')

    await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana García' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(logger.info).toHaveBeenCalledWith('ADAPTER', 'Tool request received', expect.objectContaining({
      toolName:   'confirm_booking',
      businessId: BIZ_A,
    }))
    expect(logger.info).toHaveBeenCalledWith('ADAPTER', 'Tool succeeded', expect.objectContaining({
      toolName:   'confirm_booking',
      businessId: BIZ_A,
      durationMs: expect.any(Number),
    }))
  })

  it('INT-11: logger.warn is called on tenant verification failure', async () => {
    mockVerify.mockRejectedValue(new Error('UNAUTHORIZED'))
    const { logger } = await import('@/lib/logger')

    await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    {},
      userId:     'attacker',
      businessId: 'victim-biz',
      timezone:   'UTC',
    })

    expect(logger.warn).toHaveBeenCalledWith('ADAPTER', 'Tenant verification failed', expect.objectContaining({
      businessId: 'victim-biz',
      userId:     'attacker',
    }))
  })

  // ── INT-12: Canal consistency — core produce mismos resultados ──────────────
  it('INT-12: same core logic → same result regardless of which adapter calls it', async () => {
    // Simulate two separate adapter instances (like dashboard and whatsapp)
    // calling the same BookingEngine with the same args
    const adapter1 = new DashboardBookingAdapter(mockSupabase)
    const adapter2 = new DashboardBookingAdapter(mockSupabase)

    const params = {
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Ana García' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    }

    const r1 = await adapter1.execute(params)
    // Reset create mock to return fresh result for second adapter
    mockAppointments.create.mockResolvedValue({ data: { id: APPT_ID, business_id: BIZ_A, client_id: CLI_ID, status: 'pending' } })
    mockAppointments.findConflicts.mockResolvedValue({ data: [] })
    mockClients.findActiveForAI.mockResolvedValue({ data: [ana] })
    mockServices.getActive.mockResolvedValue({ data: [manicura] })
    const r2 = await adapter2.execute(params)

    expect(r1.success).toBe(r2.success)
    expect(r1.data?.action).toBe(r2.data?.action)
    expect(r1.data?.clientName).toBe(r2.data?.clientName)
    expect(r1.data?.serviceName).toBe(r2.data?.serviceName)
  })

  // ── INT-13: get_available_slots — día cerrado ────────────────────────────────
  it('INT-13: get_available_slots on closed day → returns closed message', async () => {
    const result = await adapter.execute({
      toolName:     'get_available_slots',
      rawArgs:      { date: '2026-05-03', duration_min: 30 }, // May 3 2026 = Sunday
      userId:       'user-1',
      businessId:   BIZ_A,
      timezone:     'America/Bogota',
      workingHours: { sunday: null },
    })

    expect(result.success).toBe(true)
    expect(result.result).toContain('cerrado')
  })

  // ── INT-14: Auto-create client when not found ───────────────────────────────
  it('INT-14: new client auto-created during booking (owner fast-path)', async () => {
    const newClient: ClientForAI = { id: 'new-client-id', name: 'Juan Pérez Gómez', phone: null }
    mockClients.findActiveForAI.mockResolvedValue({ data: [] }) // no existing clients
    mockClients.insert.mockResolvedValue({ data: newClient })

    const result = await adapter.execute({
      toolName:   'confirm_booking',
      rawArgs:    { service_id: 'Manicura', date: '2026-05-10', time: '10:00', client_name: 'Juan Pérez Gómez' },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    expect(result.success).toBe(true)
    expect(result.data?.clientName).toBe('Juan Pérez Gómez')
    expect(mockClients.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: BIZ_A,
      name:        'Juan Pérez Gómez',
    }))
  })

  // ── INT-15: updateStatus cross-tenant attack ────────────────────────────────
  it('INT-15: updateStatus is called with correct businessId (cross-tenant guard)', async () => {
    await adapter.execute({
      toolName:   'cancel_booking',
      rawArgs:    { appointment_id: APPT_ID },
      userId:     'user-1',
      businessId: BIZ_A,
      timezone:   'America/Bogota',
    })

    // updateStatus must include BIZ_A — if it were omitted, any tenant could cancel
    expect(mockAppointments.updateStatus).toHaveBeenCalledWith(APPT_ID, 'cancelled', BIZ_A)
    // Should never be called with BIZ_B
    expect(mockAppointments.updateStatus).not.toHaveBeenCalledWith(APPT_ID, 'cancelled', BIZ_B)
  })
})
