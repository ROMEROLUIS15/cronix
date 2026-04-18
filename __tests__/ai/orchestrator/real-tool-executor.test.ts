/**
 * real-tool-executor.test.ts
 *
 * Unit tests for RealToolExecutor — maps tool names → UseCases via mock repos.
 * Every repo method is stubbed with vi.fn() returning Result<T>.
 *
 * Coverage:
 *   - confirm_booking  (client by name, by id, service not found, slot conflict)
 *   - cancel_booking   (success, missing id)
 *   - reschedule_booking (success, conflict)
 *   - get_appointments_by_date (populated, empty)
 *   - get_services (populated, empty)
 *   - create_client (success — exposes client_id in result, validation fail)
 *   - get_available_slots (open day, closed day, unconfigured)
 *   - unknown tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RealToolExecutor } from '@/lib/ai/orchestrator/tool-adapter/RealToolExecutor'
import type { IAppointmentQueryRepository, IAppointmentCommandRepository } from '@/lib/domain/repositories'
import type { IClientRepository } from '@/lib/domain/repositories/IClientRepository'
import type { IServiceRepository } from '@/lib/domain/repositories/IServiceRepository'
import type { ToolExecuteParams } from '@/lib/ai/orchestrator/execution-engine'

// ── Valid test UUIDs (Zod z.string().uuid() requires proper format) ───────────
const SVC_UUID = '11111111-1111-4111-8111-111111111111'
const CLI_UUID = '22222222-2222-4222-8222-222222222222'
const APT_UUID = '33333333-3333-4333-8333-333333333333'
const APT_NEW  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLI_NEW  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// ── Repo mock factories ───────────────────────────────────────────────────────

function makeQueryRepo(overrides: Partial<IAppointmentQueryRepository> = {}): IAppointmentQueryRepository {
  return {
    getMonthAppointments: vi.fn().mockResolvedValue({ data: [], error: null }),
    getDayAppointments:   vi.fn().mockResolvedValue({ data: [], error: null }),
    getDaySlots:          vi.fn().mockResolvedValue({ data: [], error: null }),
    getForEdit:           vi.fn().mockResolvedValue({ data: null, error: null }),
    findConflicts:        vi.fn().mockResolvedValue({ data: [], error: null }),
    findUpcomingByClient: vi.fn().mockResolvedValue({ data: [], error: null }),
    findByDateRange:      vi.fn().mockResolvedValue({ data: [], error: null }),
    getDashboardStats:    vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  } as unknown as IAppointmentQueryRepository
}

function makeCommandRepo(overrides: Partial<IAppointmentCommandRepository> = {}): IAppointmentCommandRepository {
  return {
    create:       vi.fn().mockResolvedValue({ data: { id: APT_NEW, business_id: 'biz-1', client_id: CLI_UUID, status: 'pending' }, error: null }),
    cancel:       vi.fn().mockResolvedValue({ data: undefined, error: null }),
    reschedule:   vi.fn().mockResolvedValue({ data: undefined, error: null }),
    updateStatus: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    ...overrides,
  } as unknown as IAppointmentCommandRepository
}

function makeClientRepo(overrides: Partial<IClientRepository> = {}): IClientRepository {
  return {
    getById:          vi.fn().mockResolvedValue({ data: { id: CLI_UUID, name: 'María García', phone: '' }, error: null }),
    findActiveForAI:  vi.fn().mockResolvedValue({ data: [{ id: CLI_UUID, name: 'María García', similarity: 1 }], error: null }),
    insert:           vi.fn().mockResolvedValue({ data: { id: CLI_NEW, name: 'Pedro López', phone: '' }, error: null }),
    ...overrides,
  } as unknown as IClientRepository
}

function makeServiceRepo(overrides: Partial<IServiceRepository> = {}): IServiceRepository {
  return {
    getActive: vi.fn().mockResolvedValue({ data: [{ id: SVC_UUID, name: 'Corte', duration_min: 30, price: 20 }], error: null }),
    ...overrides,
  } as unknown as IServiceRepository
}

function makeParams(toolName: string, args: Record<string, unknown>, extra: Partial<ToolExecuteParams> = {}): ToolExecuteParams {
  return {
    toolName,
    args,
    businessId:   'biz-1',
    userId:       'user-1',
    timezone:     'America/Bogota',
    workingHours: undefined,
    ...extra,
  }
}

function buildExecutor(overrides: {
  queryRepo?:   Partial<IAppointmentQueryRepository>
  commandRepo?: Partial<IAppointmentCommandRepository>
  clientRepo?:  Partial<IClientRepository>
  serviceRepo?: Partial<IServiceRepository>
} = {}) {
  return new RealToolExecutor(
    makeQueryRepo(overrides.queryRepo),
    makeCommandRepo(overrides.commandRepo),
    makeClientRepo(overrides.clientRepo),
    makeServiceRepo(overrides.serviceRepo),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RealToolExecutor', () => {

  // ── confirm_booking ─────────────────────────────────────────────────────────

  describe('confirm_booking', () => {
    it('creates appointment when client is found by name', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('confirm_booking', {
        service_id:  SVC_UUID,
        client_name: 'María',
        date:        '2026-05-01',
        time:        '10:00',
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('María García')
      expect(result.result).toContain('Corte')
    })

    it('creates appointment when client_id is provided directly', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('confirm_booking', {
        service_id: SVC_UUID,
        client_id:  CLI_UUID,
        date:       '2026-05-01',
        time:       '10:00',
      }))

      expect(result.success).toBe(true)
    })

    it('fails when client is not found', async () => {
      const executor = buildExecutor({
        clientRepo: {
          getById:         vi.fn().mockResolvedValue({ data: null, error: 'not found' }),
          findActiveForAI: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('confirm_booking', {
        service_id:  SVC_UUID,
        client_name: 'Nadie',
        date:        '2026-05-01',
        time:        '10:00',
      }))

      expect(result.success).toBe(false)
      expect(result.result).toContain('No encontré al cliente')
    })

    it('fails when service_id does not match any active service', async () => {
      const SVC_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      const executor = buildExecutor({
        serviceRepo: {
          getActive: vi.fn().mockResolvedValue({ data: [{ id: SVC_OTHER, name: 'Tinte', duration_min: 60, price: 40 }], error: null }),
        },
      })
      const result = await executor.execute(makeParams('confirm_booking', {
        service_id:  SVC_UUID,
        client_name: 'María',
        date:        '2026-05-01',
        time:        '10:00',
      }))

      expect(result.success).toBe(false)
      expect(result.result).toContain('servicio')
    })

    it('fails when time slot has a conflict', async () => {
      const executor = buildExecutor({
        queryRepo: {
          findConflicts: vi.fn().mockResolvedValue({ data: [{ id: APT_UUID }], error: null }),
          getDaySlots:   vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('confirm_booking', {
        service_id:  SVC_UUID,
        client_name: 'María',
        date:        '2026-05-01',
        time:        '10:00',
      }))

      expect(result.success).toBe(false)
      expect(result.result).toContain('ocupado')
    })

    it('returns validation error when required fields are missing', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('confirm_booking', {
        // missing service_id, date, time
        client_name: 'María',
      }))

      expect(result.success).toBe(false)
      expect(result.result).toContain('Faltan datos')
    })
  })

  // ── cancel_booking ──────────────────────────────────────────────────────────

  describe('cancel_booking', () => {
    it('cancels appointment successfully', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getForEdit: vi.fn().mockResolvedValue({ 
            data: { id: APT_UUID, service_id: SVC_UUID, client_id: CLI_UUID, start_at: '2026-05-01T10:00:00', appointment_services: [] }, 
            error: null 
          }),
        },
      })
      const result   = await executor.execute(makeParams('cancel_booking', {
        appointment_id: APT_UUID,
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('cancelada')
    })

    it('fails with missing appointment_id', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('cancel_booking', {}))

      expect(result.success).toBe(false)
    })

    it('propagates repo error', async () => {
      const executor = buildExecutor({
        commandRepo: {
          updateStatus: vi.fn().mockResolvedValue({ data: undefined, error: 'DB error' }),
        },
      })
      const result = await executor.execute(makeParams('cancel_booking', {
        appointment_id: APT_UUID,
      }))

      expect(result.success).toBe(false)
    })
  })

  // ── reschedule_booking ──────────────────────────────────────────────────────

  describe('reschedule_booking', () => {
    it('reschedules successfully', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getForEdit:    vi.fn().mockResolvedValue({ data: { id: APT_UUID, service_id: SVC_UUID, client_id: CLI_UUID, assigned_user_id: null, start_at: '2026-05-01T10:00:00', status: 'pending', notes: null, appointment_services: [] }, error: null }),
          findConflicts: vi.fn().mockResolvedValue({ data: [], error: null }),
          getDaySlots:   vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('reschedule_booking', {
        appointment_id: APT_UUID,
        new_date:       '2026-05-02',
        new_time:       '11:00',
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('reagendada')
    })

    it('fails when new slot has conflict', async () => {
      const OTHER_APT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      const executor = buildExecutor({
        queryRepo: {
          getForEdit:    vi.fn().mockResolvedValue({ data: { id: APT_UUID, service_id: SVC_UUID, client_id: CLI_UUID, assigned_user_id: null, start_at: '2026-05-01T10:00:00', status: 'pending', notes: null, appointment_services: [] }, error: null }),
          findConflicts: vi.fn().mockResolvedValue({ data: [{ id: OTHER_APT }], error: null }),
          getDaySlots:   vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('reschedule_booking', {
        appointment_id: APT_UUID,
        new_date:       '2026-05-02',
        new_time:       '11:00',
      }))

      expect(result.success).toBe(false)
      expect(result.result).toContain('ocupado')
    })
  })

  // ── get_appointments_by_date ────────────────────────────────────────────────

  describe('get_appointments_by_date', () => {
    it('returns formatted appointment list', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getDayAppointments: vi.fn().mockResolvedValue({
            data: [{
              id: 'apt-1', start_at: '2026-05-01T10:00:00', status: 'pending',
              client: { name: 'Pedro' },
              service: { name: 'Corte' },
              appointment_services: null,
            }],
            error: null,
          }),
          getDaySlots:   vi.fn().mockResolvedValue({ data: [], error: null }),
          findConflicts: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('get_appointments_by_date', { date: '2026-05-01' }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('Pedro')
    })

    it('returns "no hay citas" when list is empty', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('get_appointments_by_date', { date: '2026-05-01' }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('No hay citas')
    })

    it('fails with invalid date format', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('get_appointments_by_date', { date: '01-05-2026' }))

      expect(result.success).toBe(false)
    })
  })

  // ── get_services ────────────────────────────────────────────────────────────

  describe('get_services', () => {
    it('returns formatted services list', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('get_services', {}))

      expect(result.success).toBe(true)
      expect(result.result).toContain('Corte')
      expect(result.result).toContain('30')
      expect(result.result).toContain('20')
    })

    it('returns "no hay servicios" when list is empty', async () => {
      const executor = buildExecutor({
        serviceRepo: { getActive: vi.fn().mockResolvedValue({ data: [], error: null }) },
      })
      const result = await executor.execute(makeParams('get_services', {}))

      expect(result.success).toBe(true)
      expect(result.result).toContain('No hay servicios')
    })
  })

  // ── create_client ───────────────────────────────────────────────────────────

  describe('create_client', () => {
    it('registers client and exposes client_id in result', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('create_client', {
        name:  'Pedro López',
        phone: '3001234567',
      }))

      expect(result.success).toBe(true)
      // Must expose UUID for LLM to chain to confirm_booking
      expect(result.result).toContain(CLI_NEW)
      expect(result.result).toContain('client_id')
      expect(result.result).toContain('Pedro López')
    })

    it('fails when name is empty', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('create_client', { name: '' }))

      expect(result.success).toBe(false)
    })

    it('fails when name is missing', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('create_client', {}))

      expect(result.success).toBe(false)
    })

    it('propagates insert error from repo', async () => {
      const executor = buildExecutor({
        clientRepo: {
          insert: vi.fn().mockResolvedValue({ data: null, error: 'Duplicate entry' }),
        },
      })
      const result = await executor.execute(makeParams('create_client', { name: 'Test' }))

      expect(result.success).toBe(false)
    })
  })

  // ── get_available_slots ─────────────────────────────────────────────────────

  describe('get_available_slots', () => {
    it('returns available slots for an open day', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getDaySlots: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('get_available_slots', {
        date:         '2026-05-04', // Monday
        duration_min: 30,
      }, {
        workingHours: { monday: { open: '09:00', close: '11:00' } },
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('2026-05-04')
    })

    it('returns "cerrado" message for a closed day when workingHours is configured', async () => {
      const executor = buildExecutor()
      // sunday explicitly set to null -> closed
      const result = await executor.execute(makeParams('get_available_slots', {
        date:         '2026-05-03', // Sunday
        duration_min: 30,
      }, {
        workingHours: { sunday: null as any, monday: { open: '09:00', close: '18:00' } }, // sunday explicitly closed
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('cerrado')
    })

    it('uses default hours when workingHours is not configured', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getDaySlots: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      })
      const result = await executor.execute(makeParams('get_available_slots', {
        date:         '2026-05-04',
        duration_min: 30,
      }))
      // workingHours undefined → 09:00-18:00 defaults → should return slots
      expect(result.success).toBe(true)
    })

    it('returns no slots when entire day is booked', async () => {
      const executor = buildExecutor({
        queryRepo: {
          getDaySlots: vi.fn().mockResolvedValue({
            data: [{
              id: 'apt-1',
              start_at: '2026-05-04T09:00:00',
              end_at:   '2026-05-04T18:00:00',
              status:   'confirmed',
            }],
            error: null,
          }),
        },
      })
      const result = await executor.execute(makeParams('get_available_slots', {
        date:         '2026-05-04',
        duration_min: 30,
      }, {
        workingHours: { monday: { open: '09:00', close: '18:00' } },
      }))

      expect(result.success).toBe(true)
      expect(result.result).toContain('No hay horarios')
    })

    it('fails with invalid date', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('get_available_slots', {
        date:         'tomorrow',
        duration_min: 30,
      }))

      expect(result.success).toBe(false)
    })
  })

  // ── unknown tool ────────────────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns not-found error for unrecognized tool name', async () => {
      const executor = buildExecutor()
      const result   = await executor.execute(makeParams('do_magic', {}))

      expect(result.success).toBe(false)
      expect(result.result).toContain('do_magic')
    })
  })
})
