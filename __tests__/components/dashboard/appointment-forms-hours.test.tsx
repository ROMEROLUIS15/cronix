import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppointmentForm } from '@/app/[locale]/dashboard/appointments/new/hooks/use-appointment-form'
import { useEditAppointmentForm } from '@/app/[locale]/dashboard/appointments/[id]/edit/hooks/use-edit-appointment-form'

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const HOURS = {
  mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'], thu: ['09:00', '18:00'],
  fri: ['09:00', '18:00'], sat: ['09:00', '18:00'], sun: null,
}
const OUTSIDE = 'Esa hora queda fuera del horario: ese día se atiende de 09:00 a 18:00, y la cita debe terminar antes de cerrar.'
const CLOSED = 'El negocio está cerrado ese día. Elige otro día.'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  getForEdit: vi.fn(),
  getDaySlots: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
  useParams: () => ({ id: 'apt-1' }),
}))
vi.mock('@/lib/hooks/use-business-context', () => ({
  useBusinessContext: () => ({ businessId: 'biz-1', loading: false }),
}))
vi.mock('@/lib/browser-container', () => ({
  getBrowserContainer: () => ({
    clients: { getAll: async () => ({ data: [{ id: 'c1', name: 'Ana' }], error: null }) },
    services: { getActive: async () => ({ data: [{ id: 's1', name: 'Corte', duration_min: 60, price: 10 }], error: null }) },
    users: { getTeamMembers: async () => ({ data: [], error: null }) },
    businesses: { getSettings: mocks.getSettings },
    appointments: { create: mocks.create, getForEdit: mocks.getForEdit, getDaySlots: mocks.getDaySlots },
    reminders: { upsert: vi.fn(), forceCancel: vi.fn() },
    notifications: { create: vi.fn() },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const query = {
      select: () => query, eq: () => query, in: () => query, delete: () => query, insert: () => query,
      update: (values: unknown) => { mocks.update(values); return query },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    }
    return { from: () => query }
  },
}))
vi.mock('@/lib/actions/voice-assistant', () => ({ parseVoiceCommand: vi.fn() }))
vi.mock('@/lib/actions/check-appointment-limit', () => ({
  checkAppointmentLimit: async () => ({ allowed: true, limit: 30 }),
}))
vi.mock('@/lib/notifications/announce-booking-event', () => ({ announceBookingEvent: vi.fn() }))
vi.mock('@/lib/realtime/announce-appointment-change', () => ({ announceAppointmentChange: vi.fn() }))

const submitEvent = { preventDefault: () => {} } as React.FormEvent

async function settled(view: { result: { current: { validation: { validating: boolean } } } }) {
  await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
  await waitFor(() => expect(view.result.current.validation.validating).toBe(false))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSettings.mockResolvedValue({ data: { settings: { workingHours: HOURS }, timezone: LOCAL_TZ }, error: null })
  mocks.getDaySlots.mockResolvedValue({ data: [], error: null })
  mocks.create.mockResolvedValue({ data: { id: 'new-1' }, error: null })
})

describe('new appointment form and business hours', () => {
  async function formAt(startAt: string) {
    const view = renderHook(() => useAppointmentForm())
    await waitFor(() => expect(view.result.current.loadingData).toBe(false))
    act(() => view.result.current.setForm((f) => ({ ...f, client_id: 'c1', service_ids: ['s1'], start_at: startAt })))
    await settled(view)
    return view
  }

  it('refuses a time outside the hours and does not create the appointment', async () => {
    const view = await formAt('2026-11-04T19:00')
    expect(view.result.current.validation.slotError).toBe(OUTSIDE)
    expect(view.result.current.canSubmit).toBe(false)
    await act(async () => { await view.result.current.handleSubmit(submitEvent) })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses an appointment that would end after closing', async () => {
    const view = await formAt('2026-11-04T17:30')
    expect(view.result.current.validation.slotError).toBe(OUTSIDE)
  })

  it('refuses a closed day', async () => {
    const view = await formAt('2026-11-08T10:00')
    expect(view.result.current.validation.slotError).toBe(CLOSED)
  })

  it('creates an appointment inside the hours', async () => {
    const view = await formAt('2026-11-04T17:00')
    expect(view.result.current.validation.slotError).toBeNull()
    await act(async () => { await view.result.current.handleSubmit(submitEvent) })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('does not block the form when the hours could not be read', async () => {
    mocks.getSettings.mockResolvedValue({ data: null, error: 'network' })
    const view = await formAt('2026-11-04T19:00')
    expect(view.result.current.validation.slotError).toBeNull()
  })

  it('applies 09:00 to 18:00 to a business that never set its hours', async () => {
    mocks.getSettings.mockResolvedValue({ data: { settings: null, timezone: LOCAL_TZ }, error: null })
    const view = await formAt('2026-11-04T19:00')
    expect(view.result.current.validation.slotError).toBe(OUTSIDE)
  })
})

describe('edit appointment form and business hours', () => {
  const localIso = (value: string) => new Date(value).toISOString()

  async function formSavedAt(startAt: string) {
    mocks.getForEdit.mockResolvedValue({
      data: {
        id: 'apt-1', client_id: 'c1', service_id: 's1', assigned_user_id: null, status: 'pending', notes: '',
        start_at: localIso(startAt), appointment_services: [{ service_id: 's1', sort_order: 0 }],
      },
      error: null,
    })
    const view = renderHook(() => useEditAppointmentForm())
    await waitFor(() => expect(view.result.current.loadingData).toBe(false))
    await settled(view)
    return view
  }

  it('lets an old appointment outside the hours change anything but its time', async () => {
    const view = await formSavedAt('2026-11-04T23:00')
    act(() => view.result.current.setForm((f) => ({ ...f, notes: 'Trae foto', status: 'cancelled' })))
    await settled(view)
    expect(view.result.current.validation.slotError).toBeNull()
    await act(async () => { await view.result.current.handleSubmit(submitEvent) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })

  it('refuses moving an appointment outside the hours and does not save', async () => {
    const view = await formSavedAt('2026-11-04T10:00')
    act(() => view.result.current.setForm((f) => ({ ...f, start_at: '2026-11-04T20:00' })))
    await settled(view)
    expect(view.result.current.validation.slotError).toBe(OUTSIDE)
    await act(async () => { await view.result.current.handleSubmit(submitEvent) })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses moving an appointment to a closed day', async () => {
    const view = await formSavedAt('2026-11-04T10:00')
    act(() => view.result.current.setForm((f) => ({ ...f, start_at: '2026-11-08T10:00' })))
    await settled(view)
    expect(view.result.current.validation.slotError).toBe(CLOSED)
  })

  it('saves a move inside the hours', async () => {
    const view = await formSavedAt('2026-11-04T23:00')
    act(() => view.result.current.setForm((f) => ({ ...f, start_at: '2026-11-05T11:00' })))
    await settled(view)
    expect(view.result.current.validation.slotError).toBeNull()
    await act(async () => { await view.result.current.handleSubmit(submitEvent) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })
})
