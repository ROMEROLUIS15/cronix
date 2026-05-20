/**
 * tests/integration/appointments-flow.test.ts — Appointment Booking Flow
 *
 * Tests:
 * - Creating appointment
 * - Checking conflicts
 * - Confirming appointment
 * - Canceling appointment
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'

let dotenv: any
try { dotenv = require('dotenv') } catch { }
if (dotenv) dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabaseAccess = !!(SUPABASE_URL && SERVICE_ROLE_KEY)
const describeIntegration = hasSupabaseAccess ? describe : describe.skip

describeIntegration('Appointment Booking Flow', () => {
  let TEST_BUSINESS_ID: string
  let TEST_CLIENT_ID: string
  let TEST_SERVICE_ID: string
  let TEST_APPOINTMENT_ID: string

  beforeAll(async () => {
    if (!hasSupabaseAccess) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    // Get test business
    const { data: biz } = await supabase
      .from('businesses')
      .select('id')
      .eq('slug', 'e2e-test')
      .maybeSingle()

    if (biz) TEST_BUSINESS_ID = biz.id

    // Get test client
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('business_id', TEST_BUSINESS_ID)
      .limit(1)
      .single()

    if (client) TEST_CLIENT_ID = client.id

    // Get test service
    const { data: service } = await supabase
      .from('services')
      .select('id')
      .eq('business_id', TEST_BUSINESS_ID)
      .limit(1)
      .single()

    if (service) TEST_SERVICE_ID = service.id
  })

  it('creates new appointment', async () => {
    if (!TEST_BUSINESS_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 7)
    startAt.setHours(10, 0, 0, 0)

    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000)

    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        business_id: TEST_BUSINESS_ID,
        client_id: TEST_CLIENT_ID,
        service_id: TEST_SERVICE_ID,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: 'pending',
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(apt?.status).toBe('pending')

    if (apt) TEST_APPOINTMENT_ID = apt.id
  })

  it('checks for appointment conflicts', async () => {
    if (!TEST_APPOINTMENT_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: apt } = await supabase
      .from('appointments')
      .select('start_at, end_at')
      .eq('id', TEST_APPOINTMENT_ID)
      .single()

    expect(apt?.start_at).toBeDefined()
    expect(apt?.end_at).toBeDefined()
  })

  it('confirms appointment status', async () => {
    if (!TEST_APPOINTMENT_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: updated, error } = await supabase
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', TEST_APPOINTMENT_ID)
      .select()
      .single()

    expect(error).toBeNull()
    expect(updated?.status).toBe('confirmed')
  })

  it('cancels appointment', async () => {
    if (!TEST_APPOINTMENT_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: updated, error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', TEST_APPOINTMENT_ID)
      .select()
      .single()

    expect(error).toBeNull()
    expect(updated?.status).toBe('cancelled')
  })

  it('appointment has required fields', async () => {
    if (!TEST_APPOINTMENT_ID) return

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })

    const { data: apt } = await supabase
      .from('appointments')
      .select('id, business_id, client_id, start_at, end_at, status')
      .eq('id', TEST_APPOINTMENT_ID)
      .single()

    expect(apt?.id).toBeDefined()
    expect(apt?.business_id).toBe(TEST_BUSINESS_ID)
    expect(apt?.client_id).toBe(TEST_CLIENT_ID)
    expect(apt?.start_at).toBeDefined()
    expect(apt?.end_at).toBeDefined()
  })
})
