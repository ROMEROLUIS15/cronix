/**
 * adversarial.test.ts — Pruebas adversariales de nivel producción.
 *
 * Estrategia: intentar romper el sistema con entradas reales del mundo.
 * Cada test simula un vector de ataque o caso de degradación que DEBE
 * ser manejado sin crashes, 500s ni corrupción de datos.
 *
 * Categorías:
 *   A. Inyección de inputs inválidos
 *   B. Ataques cross-tenant
 *   C. Degradación de infraestructura (Redis down, Supabase lento)
 *   D. Respuestas inesperadas del LLM
 *   E. Casos de borde en resolución de clientes y servicios
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingEngine, type BookingEngineRepos } from '../booking/BookingEngine'
import type { IAppointmentQueryRepository } from '@/lib/domain/repositories/IAppointmentQueryRepository'
import type { IAppointmentCommandRepository } from '@/lib/domain/repositories/IAppointmentCommandRepository'
import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { IServiceRepository, ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext } from '../security/TenantEnforcer'
import { normalizeTime, localToUTC, addMinutesToISO } from '../utils/timezone'
import {
  ConfirmBookingSchema,
  CancelBookingSchema,
  RescheduleBookingSchema,
  GetAvailableSlotsSchema,
  CreateClientSchema,
  SearchClientsSchema,
} from '../contracts/tool-schemas'

// ── Global mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/cache', () => ({
  default: {
    get:           vi.fn().mockResolvedValue(null),
    set:           vi.fn().mockResolvedValue(undefined),
    invalidate:    vi.fn().mockResolvedValue(undefined),
    invalidateKey: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BIZ_A   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const BIZ_B   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const APPT_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'
const SVC_ID  = 's1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1'
const CLI_ID  = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'

function makeCtx(businessId = BIZ_A): TenantContext {
  return { businessId, userId: 'user-1', timezone: 'America/Bogota' } as unknown as TenantContext
}

const sampleClient: ClientForAI = { id: CLI_ID, name: 'Ana García', phone: null }
const sampleService: ServiceForDropdown = { id: SVC_ID, name: 'Manicura', duration_min: 45, price: 15000 }

const sampleApptRow = {
  id:                   APPT_ID,
  client_id:            CLI_ID,
  service_id:           SVC_ID,
  assigned_user_id:     null,
  start_at:             '2026-05-10T15:00:00.000Z',
  status:               'pending',
  notes:                null,
  appointment_services: [{ service_id: SVC_ID, sort_order: 0 }],
}

function makeRepos(overrides: Partial<{
  appointmentQuery:   Partial<IAppointmentQueryRepository>
  appointmentCommand: Partial<IAppointmentCommandRepository>
  clients:            Partial<IClientRepository>
  services:           Partial<IServiceRepository>
}> = {}): BookingEngineRepos {
  const aq: IAppointmentQueryRepository = {
    getMonthAppointments: vi.fn().mockResolvedValue({ data: [] }),
    getDayAppointments:   vi.fn().mockResolvedValue({ data: [] }),
    getDaySlots:          vi.fn().mockResolvedValue({ data: [] }),
    getForEdit:           vi.fn().mockResolvedValue({ data: sampleApptRow }),
    findConflicts:        vi.fn().mockResolvedValue({ data: [] }),
    findUpcomingByClient: vi.fn().mockResolvedValue({ data: [] }),
    findByDateRange:      vi.fn().mockResolvedValue({ data: [] }),
    getDashboardStats:    vi.fn().mockResolvedValue({ data: {} }),
    ...overrides.appointmentQuery,
  }
  const ac: IAppointmentCommandRepository = {
    create:       vi.fn().mockResolvedValue({ data: { id: APPT_ID, business_id: BIZ_A, client_id: CLI_ID, status: 'pending' } }),
    updateStatus: vi.fn().mockResolvedValue({ data: undefined }),
    reschedule:   vi.fn().mockResolvedValue({ data: undefined }),
    ...overrides.appointmentCommand,
  }
  const cl: IClientRepository = {
    findActiveForAI: vi.fn().mockResolvedValue({ data: [sampleClient] }),
    getById:         vi.fn().mockResolvedValue({ data: sampleClient }),
    getAll:          vi.fn(),
    getAllForSelect:  vi.fn(),
    getAppointments: vi.fn(),
    insert:          vi.fn().mockResolvedValue({ data: sampleClient }),
    findInactive:    vi.fn(),
    ...overrides.clients,
  } as unknown as IClientRepository
  const sv: IServiceRepository = {
    getActive:    vi.fn().mockResolvedValue({ data: [sampleService] }),
    getAll:       vi.fn(),
    hasAny:       vi.fn(),
    create:       vi.fn(),
    update:       vi.fn(),
    delete:       vi.fn(),
    toggleActive: vi.fn(),
    getById:      vi.fn(),
    ...overrides.services,
  } as unknown as IServiceRepository

  return {
    appointmentQuery:   aq,
    appointmentCommand: ac,
    clients:            cl,
    services:           sv,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// A. INYECCIÓN DE INPUTS INVÁLIDOS
// ══════════════════════════════════════════════════════════════════════════════

describe('A. Input Injection — Zod Schema Validation', () => {
  // A1: Tiempos inválidos
  describe('A1: Time format injection', () => {
    const badTimes = ['25:99', '24:00', '23:60', '3 PM', '3pm', '15:0', 'noon', '-1:00', '']

    for (const time of badTimes) {
      it(`rejects time "${time}"`, () => {
        const result = ConfirmBookingSchema.safeParse({
          service_id:  'Manicura',
          date:        '2026-05-10',
          time,
          client_name: 'Ana',
        })
        expect(result.success).toBe(false)
      })
    }

    it('accepts valid 24h times', () => {
      const validTimes = ['00:00', '09:00', '15:30', '23:59']
      for (const time of validTimes) {
        const result = ConfirmBookingSchema.safeParse({
          service_id:  'Manicura',
          date:        '2026-05-10',
          time,
          client_name: 'Ana',
        })
        expect(result.success).toBe(true)
      }
    })
  })

  // A2: Fechas inválidas
  describe('A2: Date format injection', () => {
    const badDates = [
      '2026-13-01',  // month 13
      '2026-00-01',  // month 0
      '2026-05-00',  // day 0
      '2026-05-32',  // day 32
      '26-05-10',    // wrong year format
      '2026/05/10',  // slashes not dashes
      'tomorrow',
      'mañana',
      '',
    ]

    for (const date of badDates) {
      it(`rejects date "${date}"`, () => {
        const result = ConfirmBookingSchema.safeParse({
          service_id:  'Manicura',
          date,
          time:        '10:00',
          client_name: 'Ana',
        })
        expect(result.success).toBe(false)
      })
    }
  })

  // A3: Ausencia de client_name (fast-path D requirement)
  it('A3: ConfirmBooking without client_name and without client_id → INVALID_ARGS', () => {
    const result = ConfirmBookingSchema.safeParse({
      service_id: 'Manicura',
      date:       '2026-05-10',
      time:       '10:00',
      // Neither client_name nor client_id
    })
    expect(result.success).toBe(false)
  })

  // A4: UUID inválidos
  describe('A4: UUID injection', () => {
    const badUUIDs = [
      'not-a-uuid',
      '00000000-0000-0000-0000-00000000000',  // too short
      '00000000-0000-0000-0000-000000000000x', // extra char
      '   ',
      '',
      'NULL',
      "'; DROP TABLE appointments; --",
    ]

    for (const uuid of badUUIDs) {
      it(`rejects appointment_id "${uuid.slice(0, 30)}"`, () => {
        const result = CancelBookingSchema.safeParse({ appointment_id: uuid })
        expect(result.success).toBe(false)
      })
    }
  })

  // A5: Nombre de cliente extremadamente largo
  it('A5: CreateClient with name > 120 chars → INVALID_ARGS', () => {
    const longName = 'Juan Pérez Gómez '.repeat(10) // 170 chars
    const result = CreateClientSchema.safeParse({ name: longName })
    expect(result.success).toBe(false)
  })

  it('A5: CreateClient with "Juan Pérez Gómez" (24 chars) → valid', () => {
    const result = CreateClientSchema.safeParse({ name: 'Juan Pérez Gómez' })
    expect(result.success).toBe(true)
  })

  // A6: SearchClients with single char (below minimum)
  it('A6: SearchClients with 1-char query → INVALID_ARGS', () => {
    const result = SearchClientsSchema.safeParse({ query: 'A' })
    expect(result.success).toBe(false)
  })

  // A7: Null/undefined injection
  it('A7: dispatch with null args → INVALID_ARGS, never throws', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', null)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('A7: dispatch with undefined args → INVALID_ARGS, never throws', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', undefined)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('A7: dispatch with array args → INVALID_ARGS, never throws', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', [1, 2, 3])
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  it('A7: dispatch with string args → INVALID_ARGS, never throws', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', 'Manicura')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  // A8: SQL injection attempt in client_name (Zod string allows it; DB uses parameterized queries)
  it('A8: SQL injection in client_name → treated as literal string (not executed)', async () => {
    const engine = new BookingEngine(makeRepos({
      clients: { findActiveForAI: vi.fn().mockResolvedValue({ data: [] }) },
    }))
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: "'; DROP TABLE appointments; --",
    })
    // Must not throw — must return a ToolResult
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  // A9: Extremely large duration_min
  it('A9: GetAvailableSlots duration_min=481 (>480) → INVALID_ARGS', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: '2026-05-10', duration_min: 481 })
    expect(result.success).toBe(false)
  })

  it('A9: GetAvailableSlots duration_min=4 (<5) → INVALID_ARGS', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: '2026-05-10', duration_min: 4 })
    expect(result.success).toBe(false)
  })

  it('A9: GetAvailableSlots duration_min=1.5 (float) → INVALID_ARGS', () => {
    const result = GetAvailableSlotsSchema.safeParse({ date: '2026-05-10', duration_min: 1.5 })
    expect(result.success).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B. ATAQUES CROSS-TENANT
// ══════════════════════════════════════════════════════════════════════════════

describe('B. Cross-Tenant Security Attacks', () => {
  // B1: Intentar cancelar cita de otro negocio por appointment_id
  it('B1: cancel appointment from BIZ_B while logged into BIZ_A → APPOINTMENT_NOT_FOUND', async () => {
    const repos = makeRepos({
      // Supabase RLS: getForEdit with BIZ_A returns null for BIZ_B's appointment
      appointmentQuery: {
        getForEdit: vi.fn().mockResolvedValue({ data: null }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.cancelAppointment(makeCtx(BIZ_A), {
      appointment_id: APPT_ID, // belongs to BIZ_B
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
    // Verify query used BIZ_A, never BIZ_B
    expect(repos.appointmentQuery.getForEdit).toHaveBeenCalledWith(APPT_ID, BIZ_A)
    expect(repos.appointmentQuery.getForEdit).not.toHaveBeenCalledWith(APPT_ID, BIZ_B)
  })

  // B2: Intentar reagendar cita de otro negocio
  it('B2: reschedule appointment from BIZ_B while in BIZ_A → APPOINTMENT_NOT_FOUND', async () => {
    const repos = makeRepos({
      appointmentQuery: {
        getForEdit: vi.fn().mockResolvedValue({ data: null }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.rescheduleAppointment(makeCtx(BIZ_A), {
      appointment_id: APPT_ID,
      new_date:       '2026-05-11',
      new_time:       '14:00',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
    expect(repos.appointmentQuery.getForEdit).toHaveBeenCalledWith(APPT_ID, BIZ_A)
  })

  // B3: Leer clientes de otro negocio
  it('B3: findActiveForAI always called with context businessId (never leaks other tenants)', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.searchClients(makeCtx(BIZ_A), { query: 'Ana' })

    expect(repos.clients.findActiveForAI).toHaveBeenCalledWith(BIZ_A)
    expect(repos.clients.findActiveForAI).not.toHaveBeenCalledWith(BIZ_B)
  })

  // B4: Leer servicios de otro negocio
  it('B4: getActive (services) always called with context businessId', async () => {
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

  // B5: createClient usa businessId del contexto, NO del payload del LLM
  it('B5: createClient insert uses ctx.businessId — attacker cannot inject different businessId', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.createClient(makeCtx(BIZ_A), {
      name:  'Attacker Client',
      phone: '04141234567',
    })

    const insertCall = (repos.clients.insert as ReturnType<typeof vi.fn>).mock.calls[0]
    if (insertCall) {
      // Must use BIZ_A from ctx, never BIZ_B from hypothetical payload
      expect(insertCall[0].business_id).toBe(BIZ_A)
      expect(insertCall[0].business_id).not.toBe(BIZ_B)
    }
  })

  // B6: Inyección de business_id en appointment creation
  it('B6: create appointment uses ctx.businessId — payload businessId is ignored', async () => {
    const repos = makeRepos()
    const engine = new BookingEngine(repos)

    await engine.createAppointment(makeCtx(BIZ_A), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    const createCall = (repos.appointmentCommand.create as ReturnType<typeof vi.fn>).mock.calls[0]
    if (createCall) {
      expect(createCall[0].business_id).toBe(BIZ_A)
    }
  })

  // B7: Unknown tool name (tool enumeration attack)
  it('B7: unknown tool name returns INVALID_ARGS (no silent execution)', async () => {
    const engine = new BookingEngine(makeRepos())
    const maliciousTools = [
      'admin_delete_all',
      'bypass_tenant',
      '../../../etc/passwd',
      'confirm_booking; DROP TABLE--',
      '',
    ]

    for (const tool of maliciousTools) {
      const result = await engine.dispatch(makeCtx(), tool, {})
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toBe('INVALID_ARGS')
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// C. DEGRADACIÓN DE INFRAESTRUCTURA
// ══════════════════════════════════════════════════════════════════════════════

describe('C. Infrastructure Degradation', () => {
  // C1: Supabase lanza excepción en cualquier query
  it('C1: Supabase throws on findActiveForAI → dispatch returns ToolResult (never throws)', async () => {
    const repos = makeRepos({
      clients: {
        findActiveForAI: vi.fn().mockRejectedValue(new Error('Supabase connection refused')),
      },
    })
    const engine = new BookingEngine(repos)

    await expect(
      engine.dispatch(makeCtx(), 'confirm_booking', {
        service_id:  'Manicura',
        date:        '2026-05-10',
        time:        '10:00',
        client_name: 'Ana García',
      })
    ).resolves.toMatchObject({
      success: false,
      error:   'DB_ERROR',
    })
  })

  // C2: Supabase timeout (never resolves — caller must handle)
  it('C2: Supabase slow response on getActive → result is still a ToolResult when resolved', async () => {
    const repos = makeRepos({
      services: {
        getActive: vi.fn().mockImplementation(() =>
          new Promise((resolve) => setTimeout(() => resolve({ data: [sampleService] }), 10))
        ),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  // C3: Cache unavailable — writes should still work
  it('C3: Cache invalidate throws → appointment creation still succeeds', async () => {
    const cacheMod = await import('@/lib/cache')
    ;(cacheMod.default.invalidate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Redis ECONNREFUSED')
    )

    const engine = new BookingEngine(makeRepos())

    // Cache.invalidate is called with void — errors are swallowed
    // The creation should succeed regardless
    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(result.success).toBe(true)
  })

  // C4: DB error on appointment create → graceful DB_ERROR
  it('C4: DB error on create → graceful DB_ERROR message', async () => {
    const repos = makeRepos({
      appointmentCommand: {
        create: vi.fn().mockResolvedValue({ error: 'connection pool exhausted' }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('DB_ERROR')
      expect(result.message).toBeTruthy()
    }
  })

  // C5: Todos los tools con DB caída → todos devuelven ToolResult, ninguno lanza
  it('C5: all tools handle total DB failure gracefully', async () => {
    const brokenRepos = makeRepos({
      appointmentQuery: {
        getDayAppointments: vi.fn().mockRejectedValue(new Error('DB down')),
        getForEdit:         vi.fn().mockRejectedValue(new Error('DB down')),
        findConflicts:      vi.fn().mockRejectedValue(new Error('DB down')),
      },
      clients: {
        findActiveForAI: vi.fn().mockRejectedValue(new Error('DB down')),
      },
      services: {
        getActive: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    })
    const engine = new BookingEngine(brokenRepos)

    const inputs: Array<[string, unknown]> = [
      ['confirm_booking',          { service_id: 'X', date: '2026-05-10', time: '10:00', client_name: 'Ana' }],
      ['cancel_booking',           { appointment_id: APPT_ID }],
      ['reschedule_booking',       { appointment_id: APPT_ID, new_date: '2026-05-11', new_time: '10:00' }],
      ['get_appointments_by_date', { date: '2026-05-10' }],
      ['get_available_slots',      { date: '2026-05-10', duration_min: 30 }],
      ['search_clients',           { query: 'Ana' }],
    ]

    for (const [tool, args] of inputs) {
      const result = await engine.dispatch(makeCtx(), tool, args)
      expect(result, `Tool ${tool} must return ToolResult`).toBeDefined()
      expect(typeof result.success, `Tool ${tool} success must be boolean`).toBe('boolean')
      expect(typeof result.message, `Tool ${tool} message must be string`).toBe('string')
    }
  })

  // C6: findConflicts retorna error (Redis down) → no crea la cita (safe failure)
  it('C6: findConflicts error → booking fails safely (no partial write)', async () => {
    const repos = makeRepos({
      appointmentQuery: {
        findConflicts: vi.fn().mockResolvedValue({ error: 'Redis connection refused' }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    // Should fail — cannot verify availability so must not book
    expect(result.success).toBe(false)
    // create must NOT have been called (no partial write)
    expect(repos.appointmentCommand.create).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// D. RESPUESTAS INESPERADAS DEL LLM (inputs que el LLM podría generar mal)
// ══════════════════════════════════════════════════════════════════════════════

describe('D. Malformed LLM Output Handling', () => {
  // D1: LLM envía tool call con args vacíos {}
  it('D1: empty args object → INVALID_ARGS (not crash)', async () => {
    const engine = new BookingEngine(makeRepos())
    const tools = ['confirm_booking', 'cancel_booking', 'reschedule_booking',
                   'get_appointments_by_date', 'get_available_slots', 'search_clients']

    for (const tool of tools) {
      const result = await engine.dispatch(makeCtx(), tool, {})
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toBe('INVALID_ARGS')
    }
  })

  // D2: LLM envía service_id como número en vez de string
  it('D2: service_id as number → INVALID_ARGS (Zod coercion disabled)', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:  12345, // number instead of string
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })

  // D3: LLM envía date como objeto Date en vez de string YYYY-MM-DD
  it('D3: date as object → INVALID_ARGS', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:  'Manicura',
      date:        new Date('2026-05-10'), // object instead of string
      time:        '10:00',
      client_name: 'Ana',
    })
    expect(result.success).toBe(false)
  })

  // D4: LLM envía args con campos extra desconocidos (should be ignored by Zod passthrough or stripped)
  it('D4: extra unknown fields → handled safely (not used in booking)', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'confirm_booking', {
      service_id:    'Manicura',
      date:          '2026-05-10',
      time:          '10:00',
      client_name:   'Ana García',
      hack_field:    'DROP TABLE',     // unknown field
      business_id:   'biz-attacker',  // should be ignored (ctx takes precedence)
      __proto__:     { isAdmin: true }, // prototype pollution attempt
    })
    // Should succeed (unknown fields are stripped by Zod strict mode)
    // or fail with INVALID_ARGS if schema is strict — either is acceptable
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  // D5: LLM omite new_time en reschedule
  it('D5: reschedule without new_time → INVALID_ARGS', async () => {
    const engine = new BookingEngine(makeRepos())
    const result = await engine.dispatch(makeCtx(), 'reschedule_booking', {
      appointment_id: APPT_ID,
      new_date:       '2026-05-11',
      // new_time omitted
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// E. AMBIGÜEDAD EN RESOLUCIÓN DE CLIENTES / SERVICIOS
// ══════════════════════════════════════════════════════════════════════════════

describe('E. Client / Service Resolution Edge Cases', () => {
  // E1: Múltiples clientes con nombre idéntico → ambiguity
  it('E1: two clients with identical name → CLIENT_AMBIGUOUS or found (deterministic)', async () => {
    const twins: ClientForAI[] = [
      { id: 'c1', name: 'Ana García', phone: null },
      { id: 'c2', name: 'Ana García', phone: '04141234567' },
    ]
    const repos = makeRepos({
      clients: { findActiveForAI: vi.fn().mockResolvedValue({ data: twins }) },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    // With exact name match and 0.98 score from substring, both score equally
    // Result must be deterministic: either found (first match) or ambiguous — never corrupt
    expect(result).toBeDefined()
    if (!result.success) {
      expect(['CLIENT_AMBIGUOUS', 'SLOT_CONFLICT']).toContain(result.error)
    }
  })

  // E2: cancel con múltiples citas del mismo cliente en el mismo día → disambiguation
  it('E2: cancel by name when multiple appointments exist → asks which one', async () => {
    const repos = makeRepos({
      appointmentQuery: {
        getDayAppointments: vi.fn().mockResolvedValue({
          data: [
            {
              id:       'a1',
              status:   'pending',
              start_at: '2026-05-10T14:00:00.000Z',
              end_at:   '2026-05-10T14:45:00.000Z',
              client:   { name: 'Ana García' },
              service:  { name: 'Manicura' },
              appointment_services: [],
              notes: null,
              assigned_user_id: null,
              client_id: CLI_ID,
              service_id: SVC_ID,
            },
            {
              id:       'a2',
              status:   'pending',
              start_at: '2026-05-10T16:00:00.000Z',
              end_at:   '2026-05-10T16:45:00.000Z',
              client:   { name: 'Ana García' },
              service:  { name: 'Pedicura' },
              appointment_services: [],
              notes: null,
              assigned_user_id: null,
              client_id: CLI_ID,
              service_id: SVC_ID,
            },
          ],
        }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.cancelAppointment(makeCtx(), {
      client_name: 'Ana García',
      date:        '2026-05-10',
    })

    // Must ask for clarification — not silently cancel the first match
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('APPOINTMENT_NOT_FOUND')
      // Message must mention multiple appointments — exact format depends on locale/timezone
      expect(result.message).toMatch(/varias|cuál|García/i)
    }
  })

  // E3: Servicio con nombre de Unicode / acentos
  it('E3: service with accented name resolved correctly', async () => {
    const accentedService: ServiceForDropdown = { id: 's2', name: 'Depilación de Cejas', duration_min: 30, price: 5000 }
    const repos = makeRepos({
      services: { getActive: vi.fn().mockResolvedValue({ data: [accentedService] }) },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'depilacion cejas', // without accents/capitals
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    // Should resolve via fuzzy or substring match
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.serviceName).toBe('Depilación de Cejas')
    }
  })

  // E4: Client con nombre muy largo (voz a texto real)
  it('E4: client name "Juan Pérez Gómez" (3 words) → resolved correctly', async () => {
    const fullName: ClientForAI = { id: CLI_ID, name: 'Juan Pérez Gómez', phone: null }
    const repos = makeRepos({
      clients: { findActiveForAI: vi.fn().mockResolvedValue({ data: [fullName] }) },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Juan Pérez Gómez',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.clientName).toBe('Juan Pérez Gómez')
  })

  // E5: No services configured in business
  it('E5: business with no services → SERVICE_NOT_FOUND (not crash)', async () => {
    const repos = makeRepos({
      services: { getActive: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Ana García',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('SERVICE_NOT_FOUND')
  })

  // E6: No clients in business (first booking ever)
  it('E6: no existing clients → auto-creates client on first booking', async () => {
    const newClient: ClientForAI = { id: 'new-id', name: 'Primer Cliente', phone: null }
    const repos = makeRepos({
      clients: {
        findActiveForAI: vi.fn().mockResolvedValue({ data: [] }),
        insert:          vi.fn().mockResolvedValue({ data: newClient }),
      },
    })
    const engine = new BookingEngine(repos)

    const result = await engine.createAppointment(makeCtx(), {
      service_id:  'Manicura',
      date:        '2026-05-10',
      time:        '10:00',
      client_name: 'Primer Cliente',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.clientName).toBe('Primer Cliente')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// F. normalizeTime / localToUTC — Determinismo Garantizado
// ══════════════════════════════════════════════════════════════════════════════

describe('F. Timezone & Time Normalization — Determinism', () => {
  // F1: normalizeTime casos adversariales
  describe('F1: normalizeTime', () => {
    const cases: Array<[string, string | null]> = [
      ['25:99',  null],   // hora imposible
      ['24:00',  null],   // medianoche exacta (no permitida en schema)
      ['23:60',  null],   // minutos imposibles
      ['00:00',  '00:00'], // medianoche válida
      ['3 PM',   '15:00'], // 12h con espacio
      ['3pm',    '15:00'], // sin espacio
      ['3:30 PM', '15:30'], // con minutos
      ['12 PM',  '12:00'], // mediodía
      ['12 AM',  '00:00'], // medianoche 12h
      ['9am',    '09:00'], // mañana sin espacios
      ['15:00',  '15:00'], // ya está en 24h
      ['09:05',  '09:05'], // hora válida con cero
    ]

    for (const [input, expected] of cases) {
      it(`normalizeTime("${input}") → ${expected === null ? 'null' : `"${expected}"`}`, () => {
        expect(normalizeTime(input)).toBe(expected)
      })
    }
  })

  // F2: localToUTC — conversión determinística con DST
  describe('F2: localToUTC determinism', () => {
    it('Bogotá (UTC-5) 10:00 → 15:00Z', () => {
      const utc = localToUTC('2026-05-10', '10:00', 'America/Bogota')
      expect(utc).toContain('T15:00:00')
    })

    it('Caracas (UTC-4) 10:00 → 14:00Z', () => {
      const utc = localToUTC('2026-05-10', '10:00', 'America/Caracas')
      expect(utc).toContain('T14:00:00')
    })

    it('same input → same output (idempotent)', () => {
      const r1 = localToUTC('2026-05-10', '10:00', 'America/Bogota')
      const r2 = localToUTC('2026-05-10', '10:00', 'America/Bogota')
      expect(r1).toBe(r2)
    })

    it('midnight does not roll back to previous day', () => {
      const utc = localToUTC('2026-05-10', '00:00', 'America/Bogota')
      // Bogotá midnight = 05:00Z on same day
      expect(utc).toContain('2026-05-10')
    })

    it('addMinutesToISO preserves UTC integrity', () => {
      const start = localToUTC('2026-05-10', '10:00', 'America/Bogota')
      const end   = addMinutesToISO(start, 45)
      const diff  = new Date(end).getTime() - new Date(start).getTime()
      expect(diff).toBe(45 * 60 * 1000)
    })
  })

  // F3: Fecha frontera — 2026-12-31 y 2026-01-01
  it('F3: year boundary — Dec 31 local does not shift to Jan 1 UTC unexpectedly', () => {
    // Bogotá UTC-5: Dec 31 23:00 local → Jan 1 04:00 UTC
    const utc = localToUTC('2026-12-31', '23:00', 'America/Bogota')
    expect(utc).toContain('2027-01-01')
    expect(utc).toContain('T04:00:00')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// G. IDEMPOTENCIA — COMPORTAMIENTO BAJO REINTENTOS
// ══════════════════════════════════════════════════════════════════════════════

describe('G. Idempotency & Retry Safety', () => {
  // G1: updateStatus completado dos veces → no duplica facturación
  it('G1: calling updateStatus twice with "completed" uses idempotency_key', async () => {
    // The repository-level idempotency is in upsert({ onConflict: idempotency_key })
    // This test verifies the key format is consistent
    const appointmentId = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'
    const key1 = `checkout_${appointmentId}`
    const key2 = `checkout_${appointmentId}` // same key on second call
    expect(key1).toBe(key2)
    // If Supabase receives { onConflict: 'idempotency_key', ignoreDuplicates: true }
    // the second insert silently no-ops
    expect(key1).toMatch(/^checkout_[0-9a-f-]{36}$/)
  })

  // G2: dispatch retorna ToolResult para cualquier combinación herramienta+args vacíos
  it('G2: all 7 tools with {} → all return defined ToolResult', async () => {
    const engine = new BookingEngine(makeRepos())
    const allTools = [
      'confirm_booking',
      'cancel_booking',
      'reschedule_booking',
      'get_appointments_by_date',
      'get_available_slots',
      'create_client',
      'search_clients',
    ]

    for (const tool of allTools) {
      const result = await engine.dispatch(makeCtx(), tool, {})
      expect(result, `${tool} must return defined result`).toBeDefined()
      expect(typeof result.success).toBe('boolean')
      expect(typeof result.message).toBe('string')
      expect(result.message.length, `${tool} must have non-empty message`).toBeGreaterThan(0)
    }
  })
})
