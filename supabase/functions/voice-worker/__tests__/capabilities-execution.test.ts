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
    expect(res.result).toContain('09:00')
    // F1 regression: booked-set window must use localToUTC, not naive date strings.
    const sel = m.opsFor('appointments')[0]
    expect(sel.gte?.[1]).toBe(localToUTC('2026-06-15', '00:00', TZ))
    expect(sel.lte?.[1]).toBe(localToUTC('2026-06-15', '23:59', TZ))
    expect(sel.gte?.[1]).not.toBe('2026-06-15T00:00:00')
  })
})
