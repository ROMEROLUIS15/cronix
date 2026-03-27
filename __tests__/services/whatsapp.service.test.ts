import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendAppointmentReminder } from '@/lib/services/whatsapp.service'
import type { ReminderMessageParams } from '@/lib/services/whatsapp.service'

const VALID_PARAMS: ReminderMessageParams = {
  to:           '+573001234567',
  clientName:   'María López',
  businessName: 'Salón Cronix',
  date:         'viernes, 21 de marzo de 2026',
  time:         '10:30 AM',
}

describe('sendAppointmentReminder', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.CRON_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('returns success when edge function responds correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    }))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result).toEqual({ success: true })
    expect(fetch).toHaveBeenCalledWith(
      'https://test.supabase.co/functions/v1/whatsapp-service',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': 'test-secret',
        },
        body: JSON.stringify(VALID_PARAMS),
      }),
    )
  })

  it('returns error when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('returns error when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('returns error when edge function returns non-WhatsAppResult shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ unexpected: 'shape' }),
    }))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unexpected response shape')
  })

  it('returns error when edge function returns failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: 'Invalid phone number' }),
    }))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result).toEqual({ success: false, error: 'Invalid phone number' })
  })

  it('returns error when fetch throws network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Network timeout')
  })

  it('returns error when fetch throws non-Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('raw string error'))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unknown error')
  })

  it('handles edge function returning invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }))

    const result = await sendAppointmentReminder(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid response from Edge Function')
  })
})
