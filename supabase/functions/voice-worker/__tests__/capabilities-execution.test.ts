/**
 * Capability EXECUTION tests — verify each of the 11 voice-worker capabilities
 * actually performs its job against the database, not just that its fast-path
 * detector fires. Uses a chainable Supabase mock (./_mock-supabase.ts) so we can
 * assert the exact DB operation: schedule INSERTs, cancel UPDATEs
 * status=cancelled, reschedule UPDATEs start_at, last-visit SELECTs attended
 * history, etc. Every op is checked to be scoped by business_id (constitution
 * §4) and to return the `{ success, error? }` contract (constitution §2).
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolContext } from '../core/tool-context.ts'
import { localToUTC } from '../core/time-format.ts'
import { createMockSupabase, type MockHandle } from './_mock-supabase.ts'

import { executeSchedule }         from '../capabilities/schedule/tool.ts'
import { executeReschedule }       from '../capabilities/reschedule/tool.ts'
import { executeCancel }           from '../capabilities/cancel/tool.ts'
import { executeDeleteClient }     from '../capabilities/delete-client/tool.ts'
import { executeLastVisit }        from '../capabilities/last-visit/tool.ts'
import { executeListAppointments } from '../capabilities/list-appointments/tool.ts'
import { executeNextAppointment }  from '../capabilities/next-appointment/tool.ts'
import { executeSearchClients }    from '../capabilities/search-clients/tool.ts'
import { executeGetServices }      from '../capabilities/get-services/tool.ts'
import { executeCreateClient }     from '../capabilities/create-client/tool.ts'
import { executeAvailableSlots }   from '../capabilities/available-slots/tool.ts'
import { executeClientAppointments } from '../capabilities/client-appointments/tool.ts'

const BIZ  = 'biz-1'
const USER = 'user-1'
const TZ   = 'America/Caracas' // UTC-4, no DST → deterministic localToUTC

const CLIENT  = { id: 'cli-1', name: 'Ana Torres', phone: '04141234567' }
const SERVICE = { id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 }

function ctxWith(m: MockHandle, extra: Partial<ToolContext> = {}): ToolContext {
  // userTextCorpus = '' makes the anti-substitution/anti-hallucination guards
  // fail-open (skip), so these tests exercise the DB path directly.
  return {
    supabase:       m.supabase as SupabaseClient,
    businessId:     BIZ,
    userId:         USER,
    timezone:       TZ,
    userTextCorpus: '',
    ...extra,
  }
}

describe('voice-worker capability execution', () => {
  it('schedule → agenda: INSERT de cita pending con cliente y servicio resueltos', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] } // findConflicts → libre
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
    })

    expect(res.success).toBe(true)
    expect(res.data?.action).toBe('created')
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert).toBeTruthy()
    expect(insert.insertPayload).toMatchObject({
      business_id: BIZ, client_id: 'cli-1', service_id: 'svc-1', status: 'pending',
    })
  })

  // A team needs ≥2 assignable members for staff handling to be active.
  const TEAM = [
    { id: 'staff-1', name: 'Marielys Pérez', role: 'employee' },
    { id: 'staff-2', name: 'Carlos Gómez',   role: 'employee' },
  ]

  it('schedule → staff nombrado (staff_name): asigna assigned_user_id y acota el conflicto a ese staff', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'        && op.type === 'select') return { data: TEAM }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
      staff_name: 'Marielys',
    })

    expect(res.success).toBe(true)
    expect(res.result).toContain('con Marielys Pérez')
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ assigned_user_id: 'staff-1' })
    const conflictSel = m.opsFor('appointments').find(o => o.type === 'select')!
    expect(conflictSel.eq).toContainEqual(['assigned_user_id', 'staff-1'])
  })

  it('schedule → "con <staff>" en el corpus sin arg explícito: extracción determinista asigna', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'        && op.type === 'select') return { data: TEAM }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    const res = await executeSchedule(
      ctxWith(m, { userTextCorpus: 'agenda a ana torres para corte mañana a las 3 con marielys' }),
      { service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00' },
    )

    expect(res.success).toBe(true)
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ assigned_user_id: 'staff-1' })
  })

  it('schedule → "cita con <cliente>" NO se confunde con staff: queda sin asignar', async () => {
    const TEAM_ANA = [
      { id: 'staff-1', name: 'Ana López',   role: 'employee' },
      { id: 'staff-2', name: 'Carlos Gómez', role: 'employee' },
    ]
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'        && op.type === 'select') return { data: TEAM_ANA }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    const res = await executeSchedule(
      ctxWith(m, { userTextCorpus: 'agéndale una cita con ana torres para corte mañana a las 3' }),
      { service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00' },
    )

    expect(res.success).toBe(true)
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ assigned_user_id: null })
  })

  it('schedule → staff nombrado que no existe en el equipo (≥2 miembros): pregunta, NO agenda', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'  && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services' && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'    && op.type === 'select') return { data: TEAM }
      return { data: null }
    })
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
      staff_name: 'Valentina',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('equipo')
    expect(m.opsFor('appointments').find(o => o.type === 'insert')).toBeUndefined()
  })

  it('schedule → negocio de UNA sola persona + staff_name: NO pregunta, agenda sin asignar', async () => {
    const SOLO = [{ id: 'owner-1', name: 'Glendys Lara', role: 'owner' }]
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'        && op.type === 'select') return { data: SOLO }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    // Even if a staff_name leaks through, a one-person business must never ask.
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
      staff_name: 'Valentina',
    })

    expect(res.success).toBe(true)
    expect(res.result).not.toContain('equipo')
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ assigned_user_id: null })
    // Business-level conflict scope (no per-staff filter) when unassigned.
    const conflictSel = m.opsFor('appointments').find(o => o.type === 'select')!
    expect(conflictSel.eq.find(([c]) => c === 'assigned_user_id')).toBeUndefined()
  })

  it('schedule → negocio de UNA sola persona + "con X" en corpus: ignora staff, sin asignar', async () => {
    const SOLO = [{ id: 'owner-1', name: 'Glendys Lara', role: 'owner' }]
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'users'        && op.type === 'select') return { data: SOLO }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
      return { data: null }
    })
    const res = await executeSchedule(
      ctxWith(m, { userTextCorpus: 'agenda a ana torres para corte mañana a las 3 con marielys' }),
      { service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00' },
    )

    expect(res.success).toBe(true)
    const insert = m.opsFor('appointments').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ assigned_user_id: null })
  })

  it('reschedule → reagenda: UPDATE de start_at/end_at de la cita encontrada', async () => {
    const APT = {
      id: 'apt-1', start_at: '2026-06-15T19:00:00.000Z', end_at: '2026-06-15T19:30:00.000Z',
      client_id: 'cli-1', service_id: 'svc-1', appointment_services: [],
    }
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'appointments' && op.type === 'select') return op.selectArg === 'id' ? { data: [] } : { data: [APT] }
      if (op.table === 'appointments' && op.type === 'update') return { error: null }
      return { data: null }
    })
    const res = await executeReschedule(ctxWith(m), {
      client_name: 'Ana Torres', new_date: '2026-06-20', new_time: '16:00',
    })

    expect(res.success).toBe(true)
    expect(res.data?.action).toBe('rescheduled')
    const upd = m.opsFor('appointments').find(o => o.type === 'update')!
    expect(upd).toBeTruthy()
    expect(upd.updatePayload).toHaveProperty('start_at')
    expect(upd.updatePayload).toHaveProperty('end_at')
    expect(upd.eq).toContainEqual(['business_id', BIZ])
  })

  it('cancel → cancela: UPDATE status=cancelled scoped por business_id', async () => {
    const APT = {
      id: 'apt-1', start_at: '2026-06-15T19:00:00.000Z', end_at: '2026-06-15T19:30:00.000Z',
      client_id: 'cli-1', service_id: 'svc-1', appointment_services: [],
    }
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [APT] }
      if (op.table === 'appointments' && op.type === 'update') return { error: null }
      return { data: null }
    })
    const res = await executeCancel(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.data?.action).toBe('cancelled')
    const upd = m.opsFor('appointments').find(o => o.type === 'update')!
    expect(upd.updatePayload).toMatchObject({ status: 'cancelled' })
    expect(upd.eq).toContainEqual(['business_id', BIZ])
  })

  it('last-visit → consigue última visita: SELECT de citas ASISTIDAS pasadas', async () => {
    const ROW = {
      id: 'apt-1', start_at: '2026-05-01T14:00:00.000Z', status: 'completed',
      service: { name: 'Corte' }, appointment_services: [],
    }
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [ROW] }
      return { data: null }
    })
    const res = await executeLastVisit(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('Ana Torres')
    const sel = m.opsFor('appointments').find(o => o.type === 'select')!
    // Only attended statuses count; cancelled/no_show excluded.
    const statusIn = sel.in.find(([c]) => c === 'status')!
    expect(statusIn[1]).toContain('completed')
    expect(sel.lt?.[0]).toBe('start_at')   // strictly past
    expect(sel.eq).toContainEqual(['business_id', BIZ])
  })

  it('list-appointments → muestra citas del día: SELECT sin canceladas', async () => {
    const ROWS = [
      { start_at: '2026-06-15T13:00:00.000Z', client: { name: 'Ana Torres' }, service: { name: 'Corte' }, appointment_services: [] },
      { start_at: '2026-06-15T15:00:00.000Z', client: { name: 'Beto Ruiz' },  service: { name: 'Barba' }, appointment_services: [] },
    ]
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: ROWS }
      return { data: null }
    })
    const res = await executeListAppointments(ctxWith(m), { date: '2026-06-15' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('2 citas')
    const sel = m.opsFor('appointments').find(o => o.type === 'select')!
    expect(sel.neq).toContainEqual(['status', 'cancelled'])
    expect(sel.eq).toContainEqual(['business_id', BIZ])
  })

  it('next-appointment → próxima cita: SELECT futura pending/confirmed más cercana', async () => {
    const ROW = { start_at: '2026-06-20T14:00:00.000Z', client: { name: 'Ana Torres' }, service: { name: 'Corte' }, appointment_services: [] }
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [ROW] }
      return { data: null }
    })
    const res = await executeNextAppointment(ctxWith(m), {})

    expect(res.success).toBe(true)
    expect(res.result).toContain('próxima cita')
    const sel = m.opsFor('appointments').find(o => o.type === 'select')!
    const statusIn = sel.in.find(([c]) => c === 'status')!
    expect(statusIn[1]).toEqual(['pending', 'confirmed'])
    expect(sel.gt?.[0]).toBe('start_at')   // strictly future
    expect(sel.eq).toContainEqual(['business_id', BIZ])
  })

  it('search-clients → consigue un cliente: devuelve su teléfono', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [CLIENT] }
      return { data: null }
    })
    const res = await executeSearchClients(ctxWith(m), { query: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('04141234567')
    expect(m.opsFor('clients')[0].eq).toContainEqual(['business_id', BIZ])
  })

  it('get-services → muestra servicios del negocio', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'services' && op.type === 'select') return { data: [SERVICE] }
      return { data: null }
    })
    const res = await executeGetServices(ctxWith(m))

    expect(res.success).toBe(true)
    expect(res.result).toContain('Corte')
    const sel = m.opsFor('services')[0]
    expect(sel.eq).toContainEqual(['business_id', BIZ])
    expect(sel.eq).toContainEqual(['is_active', true])
  })

  it('create-client → registra cliente: INSERT con business_id, nombre y teléfono', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'insert') return { data: { id: 'cli-2', name: 'Pedro Pérez' } }
      return { data: null }
    })
    const res = await executeCreateClient(ctxWith(m), { name: 'Pedro Pérez', phone: '04149998877' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('registrado')
    const insert = m.opsFor('clients').find(o => o.type === 'insert')!
    expect(insert.insertPayload).toMatchObject({ business_id: BIZ, name: 'Pedro Pérez', phone: '04149998877' })
  })

  it('delete-client → elimina (soft): UPDATE deleted_at cuando no hay citas futuras', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { count: 0 } // sin citas futuras
      if (op.table === 'clients'      && op.type === 'update') return { error: null }
      return { data: null }
    })
    const res = await executeDeleteClient(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('eliminado')
    const upd = m.opsFor('clients').find(o => o.type === 'update')!
    expect(upd.updatePayload).toHaveProperty('deleted_at')
    expect(upd.eq).toContainEqual(['business_id', BIZ])
  })

  it('client-appointments → lista citas futuras activas del cliente, scoped por business_id', async () => {
    const ROWS = [
      { start_at: '2026-06-15T13:00:00.000Z', service: { name: 'Corte' }, appointment_services: [] },
      { start_at: '2026-06-20T15:00:00.000Z', service: null, appointment_services: [{ sort_order: 0, service: { name: 'Barba' } }] },
    ]
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { data: ROWS }
      return { data: null }
    })
    const res = await executeClientAppointments(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('Ana Torres tiene 2 citas próximas')
    expect(res.result).toContain('Corte')
    expect(res.result).toContain('Barba') // junction fallback when service_id is null
    const sel = m.opsFor('appointments').find(o => o.type === 'select')!
    expect(sel.eq).toContainEqual(['business_id', BIZ])
    expect(sel.eq).toContainEqual(['client_id', 'cli-1'])
    const statusIn = sel.in.find(([c]) => c === 'status')!
    expect(statusIn[1]).toEqual(['pending', 'confirmed'])
    expect(sel.gt?.[0]).toBe('start_at') // strictly future
  })

  it('client-appointments → sin citas futuras: lo dice, no inventa', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeClientAppointments(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('no tiene citas próximas')
  })

  it('available-slots → horarios libres; ventana de ocupadas acotada con localToUTC (F1)', async () => {
    const allDaysOpen = Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map(d => [d, { open: '09:00', close: '12:00' }]),
    )
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [] } // nada ocupado
      return { data: null }
    })
    const res = await executeAvailableSlots(
      ctxWith(m, { workingHours: allDaysOpen }),
      { date: '2026-06-15', duration_min: 30 },
    )

    expect(res.success).toBe(true)
    // Spoken time format (read aloud verbatim), not raw 24h "09:00".
    expect(res.result).toContain('9 de la mañana')
    // F1 regression: booked-set window must use localToUTC, not naive date strings.
    const sel = m.opsFor('appointments')[0]
    expect(sel.gte?.[1]).toBe(localToUTC('2026-06-15', '00:00', TZ))
    expect(sel.lte?.[1]).toBe(localToUTC('2026-06-15', '23:59', TZ))
    expect(sel.gte?.[1]).not.toBe('2026-06-15T00:00:00')
  })
})

describe('voice-worker capability execution — edge & safety paths', () => {
  it('schedule → horario ocupado: NO inserta y avisa', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'services'     && op.type === 'select') return { data: [SERVICE] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [{ id: 'busy' }] } // findConflicts → ocupado
      return { data: null }
    })
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('ocupado')
    expect(m.opsFor('appointments').find(o => o.type === 'insert')).toBeUndefined()
  })

  it('schedule → cliente inexistente sin register: NO inserta, ofrece registrar', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [] } // roster vacío → not_found
      return { data: null }
    })
    const res = await executeSchedule(ctxWith(m), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-06-15', time: '15:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('registre')
    expect(m.opsFor('appointments').find(o => o.type === 'insert')).toBeUndefined()
  })

  it('reschedule → faltan fecha y hora: pregunta y NO actualiza', async () => {
    const m = createMockSupabase(() => ({ data: null }))
    const res = await executeReschedule(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('fecha y hora')
    expect(m.opsFor('appointments').find(o => o.type === 'update')).toBeUndefined()
  })

  it('cancel → cliente no encontrado: NO actualiza', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeCancel(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('No encontré')
    expect(m.opsFor('appointments').find(o => o.type === 'update')).toBeUndefined()
  })

  it('delete-client → bloqueado por cita futura: NO borra (safety)', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { count: 2 } // tiene futuras
      return { data: null }
    })
    const res = await executeDeleteClient(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('No se puede eliminar')
    expect(m.opsFor('clients').find(o => o.type === 'update')).toBeUndefined()
  })

  it('delete-client → duplicados con teléfonos distintos: pide desambiguar, NO borra', async () => {
    const DUPES = [
      { id: 'a', name: 'Ana Torres', phone: '04141110000' },
      { id: 'b', name: 'Ana Torres', phone: '04242220000' },
    ]
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: DUPES }
      return { data: null }
    })
    const res = await executeDeleteClient(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('Cuál elimino')
    expect(m.opsFor('clients').find(o => o.type === 'update')).toBeUndefined()
  })

  it('last-visit → match débil (<0.80): pide confirmar el nombre, NO lee el historial', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [CLIENT] }
      return { data: null }
    })
    // "Torr" matchea "Ana Torres" solo por prefijo (similarity-only, <0.80):
    // el validador no está seguro → confirma antes de exponer la visita.
    const res = await executeLastVisit(ctxWith(m), { client_name: 'Torr' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('Ana Torres')
    expect(res.result).toContain('¿')
    // No debe consultar el historial de citas hasta confirmar la persona.
    expect(m.opsFor('appointments')).toHaveLength(0)
  })

  it('last-visit → token exacto (confianza 0.90): responde directo, sin confirmar', async () => {
    const ROW = {
      id: 'apt-1', start_at: '2026-05-01T14:00:00.000Z', status: 'completed',
      service: { name: 'Corte' }, appointment_services: [],
    }
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') return { data: [ROW] }
      return { data: null }
    })
    // "Ana" es token exacto de "Ana Torres" → confianza pisada a 0.90 → NO nag.
    const res = await executeLastVisit(ctxWith(m), { client_name: 'Ana' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('última visita')
    expect(res.result).not.toContain('¿')
    expect(m.opsFor('appointments')).toHaveLength(1)
  })

  it('last-visit → todas canceladas/no-show: lo dice, no inventa una visita', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients'      && op.type === 'select') return { data: [CLIENT] }
      if (op.table === 'appointments' && op.type === 'select') {
        return op.selectOpts?.count ? { count: 3 } : { data: [] } // sin asistidas, pero hubo pasadas
      }
      return { data: null }
    })
    const res = await executeLastVisit(ctxWith(m), { client_name: 'Ana Torres' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('no tiene visitas asistidas')
  })

  it('list-appointments → día vacío: "No hay citas"', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeListAppointments(ctxWith(m), { date: '2026-06-15' })

    expect(res.success).toBe(true)
    expect(res.result).toContain('No hay citas')
  })

  it('next-appointment → sin próximas: lo informa', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeNextAppointment(ctxWith(m), {})

    expect(res.success).toBe(true)
    expect(res.result).toContain('No tienes citas próximas')
  })

  it('available-slots → cierre fraccionario: ofrece el último slot que cabe (close 09:30 → 09:00)', async () => {
    const allDaysOpen = Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map(d => [d, { open: '09:00', close: '09:30' }]),
    )
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeAvailableSlots(
      ctxWith(m, { workingHours: allDaysOpen }),
      { date: '2026-06-15', duration_min: 30 },
    )

    expect(res.success).toBe(true)
    // The old hour-based loop (h < ch) produced ZERO slots for this window.
    expect(res.result).toContain('9 de la mañana')
    expect(res.result).not.toContain('No hay horarios')
  })

  it('available-slots → servicio más largo que la ventana restante: no ofrece slots que terminen después del cierre', async () => {
    const allDaysOpen = Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map(d => [d, { open: '09:00', close: '10:00' }]),
    )
    const m = createMockSupabase(op => {
      if (op.table === 'appointments' && op.type === 'select') return { data: [] }
      return { data: null }
    })
    const res = await executeAvailableSlots(
      ctxWith(m, { workingHours: allDaysOpen }),
      { date: '2026-06-15', duration_min: 90 },
    )

    expect(res.success).toBe(true)
    expect(res.result).toContain('No hay horarios libres')
  })

  it('delete-client → any_duplicate=true con match único de baja confianza: pide confirmación, NO borra', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [CLIENT] }
      return { data: null }
    })
    // "Torr" matchea "Ana Torres" solo por prefijo (similarity-only, <0.80).
    // El LLM no puede saltarse la confirmación emitiendo any_duplicate=true
    // sin que exista una lista de duplicados previa.
    const res = await executeDeleteClient(ctxWith(m), { client_name: 'Torr', any_duplicate: true })

    expect(res.success).toBe(false)
    expect(res.result).toContain('¿')
    expect(m.opsFor('clients').find(o => o.type === 'update')).toBeUndefined()
  })

  it('delete-client → phone que NO corresponde al match único: pide confirmación, NO borra', async () => {
    const m = createMockSupabase(op => {
      if (op.table === 'clients' && op.type === 'select') return { data: [CLIENT] }
      return { data: null }
    })
    const res = await executeDeleteClient(ctxWith(m), { client_name: 'Torr', phone: '09998887766' })

    expect(res.success).toBe(false)
    expect(m.opsFor('clients').find(o => o.type === 'update')).toBeUndefined()
  })

  it('available-slots → día cerrado: lo informa, no consulta agenda', async () => {
    const allClosed = Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(d => [d, null]),
    )
    const m = createMockSupabase(() => ({ data: null }))
    const res = await executeAvailableSlots(
      ctxWith(m, { workingHours: allClosed }),
      { date: '2026-06-15', duration_min: 30 },
    )

    expect(res.success).toBe(true)
    expect(res.result).toContain('cerrado')
    expect(m.opsFor('appointments')).toHaveLength(0)
  })
})
