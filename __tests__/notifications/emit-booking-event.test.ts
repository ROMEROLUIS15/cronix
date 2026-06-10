import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { emitBookingEvent } from '@/lib/notifications/emit-booking-event'
import type { AppointmentEvent } from '@/lib/notifications/appointment-event'

type Supabase = SupabaseClient<Database>

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EVENT_FIXTURE: AppointmentEvent = {
  eventId:      'created:biz-111:appt-999:2026-06-15:10:00',
  type:         'appointment.created',
  businessId:   'biz-111',
  businessName: 'Barbería Test',
  clientName:   'Juan Pérez',
  serviceName:  'Corte clásico',
  date:         '2026-06-15',
  time:         '10:00',
  userId:       'test-user',
  channel:      'dashboard',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockSupabaseOptions {
  /**
   * When true, `maybeSingle()` on notifications returns an existing row,
   * simulating a duplicate event_id.
   */
  duplicateEventId?: boolean
  /**
   * When set, the insert on notifications returns this error message.
   */
  insertError?: string | null
  /**
   * When true, the Realtime channel.send() throws.
   */
  channelThrows?: boolean
  /**
   * Owner phone returned for the businesses query.
   * null/undefined => no phone configured.
   */
  businessPhone?: string | null
}

function createMockSupabase(opts: MockSupabaseOptions = {}): {
  supabase: Supabase
  spies: {
    notificationsSelect: ReturnType<typeof vi.fn>
    notificationsInsert: ReturnType<typeof vi.fn>
    channelSend: ReturnType<typeof vi.fn>
    removeChannel: ReturnType<typeof vi.fn>
    businessesSelect: ReturnType<typeof vi.fn>
  }
} {
  const channelSend    = vi.fn()
  const removeChannel  = vi.fn()
  const notificationsSelect = vi.fn()
  const notificationsInsert = vi.fn()
  const businessesSelect    = vi.fn()

  const mockChannel = {
    send: channelSend,
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'notifications') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: notificationsSelect,
            })),
          })),
          insert: notificationsInsert,
        }
      }
      if (table === 'businesses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: businessesSelect,
            })),
          })),
        }
      }
      return { select: vi.fn(), insert: vi.fn() }
    }),
    channel: vi.fn(() => mockChannel),
    removeChannel,
  } as unknown as Supabase

  // Default responses
  notificationsSelect.mockResolvedValue(
    opts.duplicateEventId
      ? { data: { id: 'existing-notif' }, error: null }
      : { data: null, error: null },
  )

  notificationsInsert.mockResolvedValue(
    opts.insertError
      ? { data: null, error: { message: opts.insertError } }
      : { data: [{ id: 'new-notif' }], error: null },
  )

  businessesSelect.mockResolvedValue(
    opts.businessPhone
      ? { data: { phone: opts.businessPhone }, error: null }
      : { data: null, error: null },
  )

  if (opts.channelThrows) {
    channelSend.mockRejectedValue(new Error('Realtime unavailable'))
  } else {
    channelSend.mockResolvedValue(undefined)
  }

  removeChannel.mockResolvedValue(undefined)

  return {
    supabase,
    spies: {
      notificationsSelect,
      notificationsInsert,
      channelSend,
      removeChannel,
      businessesSelect,
    },
  }
}

// ── Environment ───────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('emitBookingEvent — AC-1: Idempotencia', () => {
  it('retorna silenciosamente cuando el eventId ya existe en DB (AC-1)', async () => {
    const { supabase, spies } = createMockSupabase({ duplicateEventId: true })

    const result = await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(result.error).toBeNull()
    expect(result.data).toBeUndefined()
    expect(spies.notificationsInsert).not.toHaveBeenCalled()
    expect(spies.channelSend).not.toHaveBeenCalled()
    expect(spies.businessesSelect).not.toHaveBeenCalled()
  })

  it('no ejecuta canales 2-4 cuando el evento ya fue procesado', async () => {
    const { supabase, spies } = createMockSupabase({ duplicateEventId: true })

    await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(spies.channelSend).not.toHaveBeenCalled()
  })
})

describe('emitBookingEvent — AC-2: Fallo DB aborta pipeline', () => {
  it('no ejecuta canales 2-4 cuando insert en DB falla (AC-2)', async () => {
    const { supabase, spies } = createMockSupabase({
      duplicateEventId: false,
      insertError: 'Database connection refused',
    })

    const result = await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(result.error).toBeNull()
    expect(spies.notificationsInsert).toHaveBeenCalledTimes(1)
    expect(spies.channelSend).not.toHaveBeenCalled()
    expect(spies.businessesSelect).not.toHaveBeenCalled()
  })
})

describe('emitBookingEvent — AC-3: Fallo canales secundarios no bloquean', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.CRON_SECRET             = 'test-cron-secret'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456'
    process.env.WHATSAPP_ACCESS_TOKEN    = 'test-wa-token'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: { message: 'Simulated error' } }),
    }))
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('fallo en Realtime no interrumpe canales 3 y 4 (AC-3)', async () => {
    const { supabase, spies } = createMockSupabase({
      duplicateEventId: false,
      insertError:      null,
      channelThrows:    true,
      businessPhone:    '584247092980',
    })

    const result = await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(result.error).toBeNull()
    expect(spies.notificationsInsert).toHaveBeenCalledTimes(1)
    expect(spies.channelSend).toHaveBeenCalledTimes(1)
    expect(spies.businessesSelect).toHaveBeenCalledTimes(1)
  })

  it('fallo en WhatsApp no interrumpe Web Push', async () => {
    const { supabase, spies } = createMockSupabase({
      duplicateEventId: false,
      insertError:      null,
      businessPhone:    '584247092980',
    })
    spies.channelSend.mockResolvedValue(undefined)
    spies.businessesSelect.mockResolvedValue({ data: { phone: '584247092980' }, error: null })

    const result = await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(result.error).toBeNull()
    expect(spies.notificationsInsert).toHaveBeenCalledTimes(1)
    expect(spies.channelSend).toHaveBeenCalledTimes(1)
    expect(spies.businessesSelect).toHaveBeenCalledTimes(1)
  })

  it('pipeline completa exitosamente con todos los canales', async () => {
    const { supabase, spies } = createMockSupabase({
      duplicateEventId: false,
      insertError:      null,
      businessPhone:    '584247092980',
    })

    const result = await emitBookingEvent(supabase, EVENT_FIXTURE)

    expect(result.error).toBeNull()
    expect(spies.notificationsInsert).toHaveBeenCalledTimes(1)
    expect(spies.channelSend).toHaveBeenCalledTimes(1)
    expect(spies.businessesSelect).toHaveBeenCalledTimes(1)
  })
})
