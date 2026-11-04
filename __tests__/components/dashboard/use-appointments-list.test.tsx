import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppointmentsList } from '@/app/[locale]/dashboard/appointments/hooks/use-appointments-list'

const mocks = vi.hoisted(() => ({
  getDayAppointments: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/browser-container', () => ({
  getBrowserContainer: () => ({ appointments: { getDayAppointments: mocks.getDayAppointments } }),
}))
vi.mock('@/lib/hooks/use-business-context', () => ({
  useBusinessContext: () => ({ businessId: 'biz-1', loading: false }),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/actions/complete-appointment', () => ({ completeAppointment: vi.fn() }))

const REFRESH_EVENT = 'cronix:realtime-refresh'

function appointment(startAt: string) {
  return { id: 'apt-1', start_at: startAt, status: 'pending', client: { name: 'Ana' }, service: { name: 'Cejas' } }
}

const OLD_TIME = { data: [appointment('2026-11-03T18:00:00Z')], error: null }
const NEW_TIME = { data: [appointment('2026-11-03T17:00:00Z')], error: null }

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

async function renderLoadedList() {
  const view = renderHook(() => useAppointmentsList())
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return view
}

describe('useAppointmentsList refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
    mocks.getDayAppointments.mockReset()
    mocks.createClient.mockReset()
    mocks.getDayAppointments.mockResolvedValue(OLD_TIME)
  })

  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  it('shows a rescheduled appointment on the next poll, with no reload', async () => {
    const { result } = await renderLoadedList()
    expect(result.current.appointments[0]?.start_at).toBe('2026-11-03T18:00:00Z')

    mocks.getDayAppointments.mockResolvedValue(NEW_TIME)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(result.current.appointments[0]?.start_at).toBe('2026-11-03T17:00:00Z')
  })

  it('keeps the list on screen during a background refresh', async () => {
    const { result } = await renderLoadedList()
    let finish: (value: typeof NEW_TIME) => void = () => undefined
    mocks.getDayAppointments.mockReturnValue(new Promise((resolve) => { finish = resolve }))

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(result.current.loading).toBe(false)
    expect(result.current.appointments).toHaveLength(1)

    await act(async () => { finish(NEW_TIME) })
    expect(result.current.appointments[0]?.start_at).toBe('2026-11-03T17:00:00Z')
  })

  it('does not poll a hidden tab, and refreshes when the tab comes back', async () => {
    await renderLoadedList()
    mocks.getDayAppointments.mockClear()
    setVisibility('hidden')

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.getDayAppointments).not.toHaveBeenCalled()

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.getDayAppointments).toHaveBeenCalledTimes(1)
  })

  it('refreshes at once on the layout listener window event', async () => {
    const { result } = await renderLoadedList()
    mocks.getDayAppointments.mockResolvedValue(NEW_TIME)

    await act(async () => {
      window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.appointments[0]?.start_at).toBe('2026-11-03T17:00:00Z')
  })

  it('never opens a Realtime channel: removing it would close the layout listener', async () => {
    const { unmount } = await renderLoadedList()
    unmount()

    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('stops refreshing after unmount', async () => {
    const { unmount } = await renderLoadedList()
    unmount()
    mocks.getDayAppointments.mockClear()

    await act(async () => {
      window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mocks.getDayAppointments).not.toHaveBeenCalled()
  })

  it('keeps the list when a background refresh fails', async () => {
    const { result } = await renderLoadedList()
    mocks.getDayAppointments.mockResolvedValue({ data: null, error: 'network' })

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(result.current.appointments).toHaveLength(1)

    mocks.getDayAppointments.mockRejectedValue(new Error('offline'))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(result.current.appointments).toHaveLength(1)
  })

  it('still empties the list and shows loading when opening a day that fails', async () => {
    const { result } = await renderLoadedList()
    let finish: (value: { data: null; error: string }) => void = () => undefined
    mocks.getDayAppointments.mockReturnValue(new Promise((resolve) => { finish = resolve }))

    await act(async () => {
      result.current.handleNextDay()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.loading).toBe(true)

    await act(async () => { finish({ data: null, error: 'network' }) })
    expect(result.current.loading).toBe(false)
    expect(result.current.appointments).toEqual([])
  })

  it('ignores a late answer for the day the user already left', async () => {
    const { result } = await renderLoadedList()
    let finishOldDay: (value: typeof OLD_TIME) => void = () => undefined
    mocks.getDayAppointments.mockReturnValueOnce(new Promise((resolve) => { finishOldDay = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    mocks.getDayAppointments.mockResolvedValue(NEW_TIME)
    await act(async () => {
      result.current.handleNextDay()
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => { finishOldDay(OLD_TIME) })

    expect(result.current.appointments[0]?.start_at).toBe('2026-11-03T17:00:00Z')
    expect(result.current.loading).toBe(false)
  })
})
