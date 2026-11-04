// @vitest-environment node
/**
 * The dashboard voice button uses the same pipeline as WhatsApp, and it does not book unless the
 * sentence asks for it: "Cambia la cita" misheard as "E2E la cita" created a new appointment
 * and answered "Listo" (measured in production, 2026-11-04).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toBookingEvent } from '../../supabase/functions/voice-worker/booking-event'
import { refersToExistingAppointment } from '../../supabase/functions/voice-worker/core/conversation/slot-extractor'
import { executeSchedule } from '../../supabase/functions/voice-worker/capabilities/schedule/tool'
import { buildUserCorpus } from '../../supabase/functions/voice-worker/core/conversation/frame'
import { detectListAppointments, isAgendaQuestion } from '../../supabase/functions/voice-worker/capabilities/list-appointments/fast-path'
import { executeReschedule } from '../../supabase/functions/voice-worker/capabilities/reschedule/tool'
import { createMockSupabase } from '../../supabase/functions/_shared/__tests__/_mock-supabase'
import type { ToolContext } from '../../supabase/functions/voice-worker/core/tool-context'

const NOTIFICATION = {
  eventId: 'rescheduled:biz:appt:2026-11-06:15:00',
  type: 'appointment.rescheduled' as const,
  businessId: 'biz',
  userId: 'user-1',
  clientName: 'Ana',
  serviceName: 'Cejas',
  date: '2026-11-06',
  time: '15:00',
}

describe('voice button event', () => {
  it('keeps the data of the write and says it came from voice', () => {
    expect(toBookingEvent(NOTIFICATION, 'Studio', 'owner')).toEqual({
      ...NOTIFICATION, businessName: 'Studio', channel: 'voice', ownerActed: true,
    })
  })

  it.each([
    ['owner', true],
    ['platform_admin', true],
    ['employee', false],
  ])('a %s using the button sets ownerActed=%s', (role, ownerActed) => {
    expect(toBookingEvent(NOTIFICATION, 'Studio', role).ownerActed).toBe(ownerActed)
  })

  it('has no notification code of its own left', () => {
    const index = readFileSync(path.resolve(__dirname, '../../supabase/functions/voice-worker/index.ts'), 'utf8')
    expect(index).toContain('emitBookingEvent')
    expect(index).not.toContain('dispatchBellNotification')
  })
})

describe('refersToExistingAppointment', () => {
  it.each([
    'agéndale a Sim Tester una cita de E2E Service el 6 de noviembre a las 11',
    'agenda a Luis para mañana a las 3',
    'agendar a Ana el viernes',
    'agenda la cita de Ana para mañana',
    'reserva una cita para Ana',
    'programa a Pedro el lunes',
    'crea una cita para Ana',
    'una cita para Ana mañana a las 3',
    'Sim Tester quiere una cita de E2E Service el viernes',
    'quiero cita para Ana mañana a las 3 corte',
    'necesito cita para Ana',
    'dame cita para Ana mañana',
    'ponle cita a Ana mañana',
    'sácale cita a Ana',
    'cita nueva para Ana',
    'cita para Ana mañana',
    'dame un turno para Ana mañana',
    'apúntame a Ana mañana',
    'y a Carlos mañana a las 5 para corte',
    'entonces a Ana mañana a las 4 para corte',
    'dale a las 3 para Ana, corte, mañana',
    'nueva',
    'una nueva',
    'sí, nueva',
    'sí',
    'mañana a las 3',
  ])('books: "%s"', (text) => {
    expect(refersToExistingAppointment(text)).toBe(false)
  })

  it.each([
    'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde',
    'cambia la cita de Sim Tester para las 4',
    'cambia una cita de Ana para las 4',
    'mueve la cita de Ana a las 3',
    'reagenda la cita de Ana para las 5',
    're agenda la cita de Ana',
    'reprograma la cita de Ana',
    'adelanta la cita de Ana',
    'la cita de Ana a las 3',
    'mi cita para las 3',
    'mover',
  ])('does not book: "%s"', (text) => {
    expect(refersToExistingAppointment(text)).toBe(true)
  })
})

describe('smart_schedule', () => {
  const db = new Proxy({}, { get() { throw new Error('touched the database') } })

  it('asks instead of booking when the turn points at an existing appointment', async () => {
    const text = 'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde'
    const ctx = { timezone: 'America/Caracas', userTurn: text, userTextCorpus: text, supabase: db } as unknown as ToolContext

    const result = await executeSchedule(ctx, { service_name: 'E2E Service', client_name: 'Sim Tester', date: '2026-11-06', time: '16:00' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('GUARD_REJECTED')
    expect(result.result).toContain('una cita nueva')
  })

  it('looks at this turn only: answering "nueva" to its own question gets past the guard', async () => {
    const earlier = 'E2E la cita de Sim Tester del 6 de noviembre para las 4 de la tarde para E2E Service'
    const ctx = { timezone: 'America/Caracas', userTurn: 'nueva', userTextCorpus: `nueva ${earlier}`, supabase: db } as unknown as ToolContext

    // Past the guard the tool reads the catalog, which is what this database refuses.
    await expect(executeSchedule(ctx, { service_name: 'E2E Service', client_name: 'Sim Tester', date: '2026-11-06', time: '16:00' })).rejects.toThrow('touched the database')
  })
})

describe('"agenda": a command or the calendar', () => {
  const today = '2026-11-04'

  it.each([
    'agenda una cita para Sim Tester de E2E Service el 6 de noviembre a las 11 de la mañana',
    'Agenda Sim tester el 7 de noviembre a las 2 de la tarde para E 12 Service',
    'agenda a Ana mañana a las 3',
    'agenda al señor Pérez hoy a las 5',
  ])('"%s" is a command: it does not answer with the day\'s list', (text) => {
    expect(detectListAppointments(text, today)).toBeNull()
  })

  it.each([
    ['agenda de hoy', '2026-11-04'],
    ['agenda de mañana', '2026-11-05'],
    ['agenda para mañana', '2026-11-05'],
    ['mi agenda del 6 de noviembre', '2026-11-06'],
    ['muéstrame la agenda de hoy', '2026-11-04'],
    ['agenda hoy', '2026-11-04'],
    ['qué citas tengo hoy', '2026-11-04'],
  ])('"%s" still reads the calendar', (text, date) => {
    expect(detectListAppointments(text, today)).toEqual({ date })
  })
})

describe('voice never lands on a date the user did not ask for', () => {
  const TOMORROWISH = '2099-01-10'
  const CLIENT_ROW = { id: 'cli-1', name: 'Ana Torres', phone: '04141234567' }
  const SERVICE_ROW = { id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 }
  const APT = {
    id: 'apt-1', start_at: `${TOMORROWISH}T15:00:00.000Z`, end_at: `${TOMORROWISH}T15:30:00.000Z`,
    client_id: 'cli-1', service_id: 'svc-1', appointment_services: [],
  }
  const mock = () => createMockSupabase((op) => {
    if (op.table === 'clients' && op.type === 'select') return { data: [CLIENT_ROW] }
    if (op.table === 'services' && op.type === 'select') return { data: [SERVICE_ROW] }
    if (op.table === 'appointments' && op.type === 'select') return op.selectArg === 'id' ? { data: [] } : { data: [APT] }
    if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
    if (op.table === 'appointments' && op.type === 'update') return { error: null }
    return { data: null }
  })
  const ctxFor = (m: ReturnType<typeof mock>, text: string) => ({
    supabase: m.supabase, businessId: 'biz-1', userId: 'user-1', timezone: 'America/Caracas', userTurn: text, userTextCorpus: text,
  }) as unknown as ToolContext
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' })

  it('still uses the new date when the user says one', async () => {
    const m = mock()
    const res = await executeReschedule(ctxFor(m, 'reagenda la cita de Ana Torres para el 15 de enero de 2099 a las 3 de la tarde'), {
      client_name: 'Ana Torres', new_date: '2099-01-15', new_time: '15:00',
    })

    expect(res.success).toBe(true)
    const update = m.opsFor('appointments').find((o) => o.type === 'update')!
    expect(update.updatePayload).toMatchObject({ start_at: '2099-01-15T19:00:00.000Z' })
  })

  it('does not move an appointment to a time already gone', async () => {
    const m = mock()
    const res = await executeReschedule(ctxFor(m, 'reagenda la cita de Ana Torres para ayer a las 3 de la tarde'), {
      client_name: 'Ana Torres', new_date: '2020-01-01', new_time: '15:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('ya pasó')
    expect(m.opsFor('appointments').some((o) => o.type === 'update')).toBe(false)
  })

  it('does not book at a time already gone', async () => {
    const m = mock()
    const res = await executeSchedule(ctxFor(m, 'agenda a Ana Torres para ayer a las 3 de la tarde para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2020-01-01', time: '15:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('ya pasó')
    expect(m.opsFor('appointments').some((o) => o.type === 'insert')).toBe(false)
  })
})

describe('a date from an earlier question does not reach the next order', () => {
  const READ = [
    { role: 'user' as const, content: '¿Qué citas tengo hoy?' },
    { role: 'assistant' as const, content: 'Tienes 6 citas el 4 de noviembre.' },
  ]
  const FUTURE = '2099-01-10'
  const APT = { id: 'apt-1', start_at: `${FUTURE}T15:00:00.000Z`, end_at: `${FUTURE}T15:30:00.000Z`, client_id: 'cli-1', service_id: 'svc-1', appointment_services: [] }
  const mock = () => createMockSupabase((op) => {
    if (op.table === 'clients' && op.type === 'select') return { data: [{ id: 'cli-1', name: 'Ana Torres', phone: '04141234567' }] }
    if (op.table === 'services' && op.type === 'select') return { data: [{ id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 }] }
    if (op.table === 'appointments' && op.type === 'select') return op.selectArg === 'id' ? { data: [] } : { data: [APT] }
    if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
    if (op.table === 'appointments' && op.type === 'update') return { error: null }
    return { data: null }
  })
  const ctxAfter = (m: ReturnType<typeof mock>, text: string, history: typeof READ = READ) => {
    const { corpus, slotCorpus } = buildUserCorpus(text, history)
    return { supabase: m.supabase, businessId: 'biz-1', userId: 'user-1', timezone: 'America/Caracas', userTurn: text, userTextCorpus: corpus, slotCorpus } as unknown as ToolContext
  }

  it('moving after "qué citas tengo hoy" keeps the day of the appointment', async () => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, 'mueve la cita de Ana Torres a las 3 de la tarde'), { client_name: 'Ana Torres', new_time: '15:00' })

    expect(res.success).toBe(true)
    const update = m.opsFor('appointments').find((o) => o.type === 'update')!
    expect(update.updatePayload).toMatchObject({ start_at: `${FUTURE}T19:00:00.000Z` })
  })

  it('booking after "qué citas tengo hoy" uses the date of this turn', async () => {
    const m = mock()
    const res = await executeSchedule(ctxAfter(m, 'agenda a Ana Torres el 10 de enero de 2099 a las 3 de la tarde para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-11-04', time: '15:00',
    })

    expect(res.success).toBe(true)
    const insert = m.opsFor('appointments').find((o) => o.type === 'insert')!
    expect(JSON.stringify(insert.insertPayload ?? insert)).toContain('2099-01-10T19:00')
  })

  it('booking with no date after that question asks for one instead of using today', async () => {
    const m = mock()
    const res = await executeSchedule(ctxAfter(m, 'agenda a Ana Torres a las 3 de la tarde para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2026-11-04', time: '15:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('la fecha')
    expect(m.opsFor('appointments').some((o) => o.type === 'insert')).toBe(false)
  })

  it('keeps slots collected over several turns', () => {
    const { slotCorpus } = buildUserCorpus('corte', [
      { role: 'user', content: 'agéndame a Luis para el 21 de mayo a las 3pm' },
      { role: 'assistant', content: '¿Para qué servicio?' },
    ])
    expect(slotCorpus).toContain('21 de mayo')
  })

  it('still keeps the name from a question for the mention guards', () => {
    const { corpus, slotCorpus } = buildUserCorpus('agéndala mañana a las 3', [
      { role: 'user', content: '¿Qué citas tiene Ana Torres hoy?' },
      { role: 'assistant', content: 'Ana Torres tiene 1 cita.' },
    ])
    expect(corpus).toContain('Ana Torres')
    expect(slotCorpus).not.toContain('hoy')
  })
})

describe('voz del dashboard only books inside the business hours', () => {
  // 2099-01-12 is a Monday, 2099-01-11 a Sunday.
  const HOURS = { monday: { open: '09:00', close: '18:00' }, sunday: null }
  const APT = { id: 'apt-1', start_at: '2099-01-12T15:00:00.000Z', end_at: '2099-01-12T15:30:00.000Z', client_id: 'cli-1', service_id: 'svc-1', appointment_services: [] }
  const mock = () => createMockSupabase((op) => {
    if (op.table === 'clients' && op.type === 'select') return { data: [{ id: 'cli-1', name: 'Ana Torres', phone: '04141234567' }] }
    if (op.table === 'services' && op.type === 'select') return { data: [{ id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 }] }
    if (op.table === 'appointments' && op.type === 'select') return op.selectArg === 'id' ? { data: [] } : { data: [APT] }
    if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
    if (op.table === 'appointments' && op.type === 'update') return { error: null }
    return { data: null }
  })
  const ctx = (m: ReturnType<typeof mock>, text: string) => ({
    supabase: m.supabase, businessId: 'biz-1', userId: 'user-1', timezone: 'America/Caracas', workingHours: HOURS,
    userTurn: text, userTextCorpus: text, slotCorpus: text,
  }) as unknown as ToolContext
  const wrote = (m: ReturnType<typeof mock>) => m.opsFor('appointments').some((o) => o.type === 'insert' || o.type === 'update')

  it.each([
    ['after closing', 'mueve la cita de Ana Torres a las 8 de la noche', '20:00'],
    ['before opening', 'mueve la cita de Ana Torres a las 7 de la mañana', '07:00'],
    ['ending after closing', 'mueve la cita de Ana Torres a las 5 y 45 de la tarde', '17:45'],
  ])('does not move an appointment %s', async (_label, text, time) => {
    const m = mock()
    const res = await executeReschedule(ctx(m, text), { client_name: 'Ana Torres', new_date: '2099-01-12', new_time: time })

    expect(res.success).toBe(false)
    expect(res.result).toContain('horario')
    expect(wrote(m)).toBe(false)
  })

  it('does not move an appointment to a closed day', async () => {
    const m = mock()
    const res = await executeReschedule(ctx(m, 'reagenda la cita de Ana Torres para el 11 de enero de 2099 a las 10 de la mañana'), { client_name: 'Ana Torres', new_date: '2099-01-11', new_time: '10:00' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('cerrado')
    expect(wrote(m)).toBe(false)
  })

  it.each([
    ['at closing minus its duration', '17:30'],
    ['at opening', '09:00'],
  ])('moves an appointment %s', async (_label, time) => {
    const m = mock()
    const res = await executeReschedule(ctx(m, `mueve la cita de Ana Torres a las ${time}`), { client_name: 'Ana Torres', new_time: time })

    expect(res.success).toBe(true)
    expect(wrote(m)).toBe(true)
  })

  it('does not book after closing', async () => {
    const m = mock()
    const res = await executeSchedule(ctx(m, 'agenda a Ana Torres el 12 de enero de 2099 a las 8 de la noche para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2099-01-12', time: '20:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('horario')
    expect(wrote(m)).toBe(false)
  })

  it('does not book on a closed day', async () => {
    const m = mock()
    const res = await executeSchedule(ctx(m, 'agenda a Ana Torres el 11 de enero de 2099 a las 10 de la mañana para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2099-01-11', time: '10:00',
    })

    expect(res.success).toBe(false)
    expect(res.result).toContain('cerrado')
    expect(wrote(m)).toBe(false)
  })

  it('books inside the hours', async () => {
    const m = mock()
    const res = await executeSchedule(ctx(m, 'agenda a Ana Torres el 12 de enero de 2099 a las 10 de la mañana para Corte'), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2099-01-12', time: '10:00',
    })

    expect(res.success).toBe(true)
  })

  it('uses 09:00 to 18:00 when the business never set its hours', async () => {
    const m = mock()
    const text = 'mueve la cita de Ana Torres a las 8 de la noche'
    const res = await executeReschedule({ ...ctx(m, text), workingHours: undefined }, { client_name: 'Ana Torres', new_date: '2099-01-12', new_time: '20:00' })

    expect(res.success).toBe(false)
    expect(res.result).toContain('horario')
  })
})

describe('a voice order keeps the date the user gave', () => {
  const NOW_APT = '2099-01-12'
  const APT = { id: 'apt-1', start_at: `${NOW_APT}T15:00:00.000Z`, end_at: `${NOW_APT}T15:30:00.000Z`, client_id: 'cli-1', service_id: 'svc-1', appointment_services: [] }
  const mock = () => createMockSupabase((op) => {
    if (op.table === 'clients' && op.type === 'select') return { data: [{ id: 'cli-1', name: 'Ana Torres', phone: '04141234567' }] }
    if (op.table === 'services' && op.type === 'select') return { data: [{ id: 'svc-1', name: 'Corte', duration_min: 30, price: 10 }] }
    if (op.table === 'appointments' && op.type === 'select') return op.selectArg === 'id' ? { data: [] } : { data: [APT] }
    if (op.table === 'appointments' && op.type === 'insert') return { data: { id: 'apt-new' } }
    if (op.table === 'appointments' && op.type === 'update') return { error: null }
    return { data: null }
  })
  type Turn = { role: 'user' | 'assistant'; content: string }
  const ctxAfter = (m: ReturnType<typeof mock>, text: string, history: Turn[]) => {
    const { corpus, slotCorpus } = buildUserCorpus(text, history)
    return { supabase: m.supabase, businessId: 'biz-1', userId: 'user-1', timezone: 'America/Caracas', userTurn: text, userTextCorpus: corpus, slotCorpus } as unknown as ToolContext
  }
  const startOf = (m: ReturnType<typeof mock>) => (m.opsFor('appointments').find((o) => o.type === 'update')?.updatePayload as { start_at?: string } | undefined)?.start_at

  it.each([
    'tengo que mover a Ana Torres para el 20 de enero de 2099',
    'hay que mover a Ana Torres al 20 de enero de 2099',
    'que sea el 20 de enero de 2099',
    'cuando puedas, mueve a Ana Torres al 20 de enero de 2099',
  ])('"%s" then "a las 3" uses that date', async (first) => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, 'a las 3 de la tarde', [{ role: 'user', content: 'reagenda a Ana Torres' }, { role: 'assistant', content: '¿Para cuándo?' }, { role: 'user', content: first }, { role: 'assistant', content: '¿A qué hora?' }]), { client_name: 'Ana Torres', new_time: '15:00' })

    expect(res.success).toBe(true)
    expect(startOf(m)).toBe('2099-01-20T19:00:00.000Z')
  })

  it('books the date given in an order that opens like a question', async () => {
    const m = mock()
    const res = await executeSchedule(ctxAfter(m, 'tengo que agendar a Ana Torres el 20 de enero de 2099 a las 3 de la tarde para Corte', []), {
      service_name: 'Corte', client_name: 'Ana Torres', date: '2099-01-20', time: '15:00',
    })

    expect(res.success).toBe(true)
  })

  it.each([
    'qué horarios libres hay el 20 de enero de 2099',
    'tengo libre el 20 de enero de 2099',
  ])('an availability question names the date meant: "%s"', async (first) => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, 'mueve la cita de Ana Torres a las 3 de la tarde', [{ role: 'user', content: first }, { role: 'assistant', content: 'A las 3 está libre.' }]), { client_name: 'Ana Torres', new_time: '15:00' })

    expect(res.success).toBe(true)
    expect(startOf(m)).toBe('2099-01-20T19:00:00.000Z')
  })

  it.each([
    ['the parser cannot read it', 'pasa a Ana Torres para el primero de febrero de 2099 a las 3', '2099-02-01', [] as Turn[]],
    ['the assistant proposed it', 'sí', '2099-01-20', [{ role: 'user', content: 'reagenda a Ana Torres' }, { role: 'assistant', content: '¿La paso para el 20 de enero a las 3?' }]],
  ])('keeps the date from the model when %s', async (_label, text, date, history) => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, text, history as Turn[]), { client_name: 'Ana Torres', new_date: date, new_time: '15:00' })

    expect(res.success).toBe(true)
    expect(startOf(m)).toBe(`${date}T19:00:00.000Z`)
  })

  it.each([
    'oye, qué citas tengo hoy',
    'y qué citas tengo hoy',
    'a ver, qué citas tengo hoy',
    'agenda de hoy',
    'mis citas de hoy',
  ])('the agenda question "%s" still does not move it to today', async (first) => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, 'mueve la cita de Ana Torres a las 3 de la tarde', [{ role: 'user', content: first }, { role: 'assistant', content: 'Tienes 6 citas.' }]), { client_name: 'Ana Torres', new_time: '15:00' })

    expect(res.success).toBe(true)
    expect(startOf(m)).toBe(`${NOW_APT}T19:00:00.000Z`)
  })

  it('a bare number answering the hour is not a day of the month', async () => {
    const m = mock()
    const res = await executeReschedule(ctxAfter(m, '3', [{ role: 'user', content: 'reagenda a Ana Torres para el 20 de enero de 2099' }, { role: 'assistant', content: '¿A qué hora?' }]), { client_name: 'Ana Torres', new_time: '15:00' })

    expect(res.success).toBe(true)
    expect(startOf(m)).toBe('2099-01-20T19:00:00.000Z')
  })
})

describe('an order is not an agenda question, wherever it starts', () => {
  it.each([
    'cuando puedas, agenda a Ana el viernes',
    'oye, agenda a Ana el viernes',
    'dale, agenda a Ana el viernes',
    'por favor agenda a Ana el viernes',
    'bueno agenda a Ana el viernes',
    'mueve las citas de Ana al viernes',
    'pasa las citas de Ana para el viernes',
    'cambia las citas de Ana al viernes',
  ])('"%s" is an order', (text) => {
    expect(isAgendaQuestion(text)).toBe(false)
  })

  it.each([
    'oye, agenda de hoy',
    'por favor agenda de mañana',
    'qué citas tengo pasado mañana',
    'muéstrame las citas de hoy',
    'mi agenda del viernes',
  ])('"%s" still asks about the agenda', (text) => {
    expect(isAgendaQuestion(text)).toBe(true)
  })
})
