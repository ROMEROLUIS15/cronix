/**
 * Voice tools must mark real Supabase failures with `error: 'DB_ERROR'` so the
 * AI-failure alert (observability §5) can tell them apart from clarification
 * turns, which carry no code.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolContext } from '../core/tool-context.ts'
import { createMockSupabase, type MockHandle } from './_mock-supabase.ts'
import { executeAvailableSlots }   from '../capabilities/available-slots/tool.ts'
import { executeListAppointments } from '../capabilities/list-appointments/tool.ts'
import { executeCreateClient }     from '../capabilities/create-client/tool.ts'

function ctxWith(m: MockHandle): ToolContext {
  return {
    supabase:       m.supabase as SupabaseClient,
    businessId:     'biz-1',
    userId:         'user-1',
    timezone:       'America/Caracas',
    userTextCorpus: '',
  }
}

const failing = () => createMockSupabase(() => ({ data: null, error: { message: 'connection reset' } }))

describe('voice tools → DB_ERROR on Supabase failure', () => {
  it('available-slots marks a failed bookings query as DB_ERROR', async () => {
    const res = await executeAvailableSlots(ctxWith(failing()), { date: '2026-06-15', duration_min: 30 })
    expect(res.success).toBe(false)
    expect(res.error).toBe('DB_ERROR')
  })

  it('list-appointments marks a failed query as DB_ERROR', async () => {
    const res = await executeListAppointments(ctxWith(failing()), { date: '2026-06-15' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('DB_ERROR')
  })

  it('create-client marks a generic insert failure as DB_ERROR', async () => {
    const res = await executeCreateClient(ctxWith(failing()), { name: 'Ana Torres' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('DB_ERROR')
  })

  it('create-client keeps duplicate-phone conflicts code-less (user-facing, not an incident)', async () => {
    const m = createMockSupabase(() => ({
      data: null, error: { message: 'duplicate key idx_clients_business_phone_digits' },
    }))
    const res = await executeCreateClient(ctxWith(m), { name: 'Ana Torres', phone: '04141234567' })
    expect(res.success).toBe(false)
    expect(res.error).toBeUndefined()
  })

  it('validation returns carry no code', async () => {
    const res = await executeListAppointments(ctxWith(failing()), { date: 'mañana' })
    expect(res.success).toBe(false)
    expect(res.error).toBeUndefined()
  })
})
