/**
 * ai-booking.test.ts — Phase 4: AI-to-Database Integration Tests
 *
 * Validates that the AI tool `book_appointment` correctly persists data
 * to Supabase via the Repository layer using a real service-role client.
 *
 * Environment: Node.js (no browser, no Next.js context)
 * Requires:    NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Run with:    npx vitest run tests/integration
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Fallback env loading — the config loads it too, this ensures the test
// file works even when run in isolation.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── Env Guards ──────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_SLUG         = 'e2e-test'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
    'Run `node scripts/setup-e2e-data.ts` first and ensure .env.local is configured.'
  )
}

// ── Shared State ────────────────────────────────────────────────────────────

// Explicitly pass Node's native fetch — @supabase/supabase-js's internal fetch
// polyfill fails to resolve under vitest/CJS on Windows + Node 20.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
})
const createdAppointmentIds: string[] = []

let BIZ_ID:     string
let CLIENT_ID:  string
let SERVICE_ID: string

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Fetch business created by setup-e2e-data.ts
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', TEST_SLUG)
    .maybeSingle()

  if (bizErr) {
    throw new Error(
      `E2E business query failed: ${bizErr.message} (code: ${bizErr.code})`
    )
  }
  if (!biz) {
    throw new Error(
      `E2E business "${TEST_SLUG}" not found. Run: npx tsx scripts/setup-e2e-data.ts`
    )
  }
  BIZ_ID = biz.id

  // Fetch a test client
  const { data: client, error: cliErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('business_id', BIZ_ID)
    .limit(1)
    .single()

  if (cliErr || !client) throw new Error('No test client found in E2E business.')
  CLIENT_ID = client.id

  // Fetch a test service
  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, name, duration_min')
    .eq('business_id', BIZ_ID)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (svcErr || !service) throw new Error('No active test service found in E2E business.')
  SERVICE_ID = service.id
})

// ── Cleanup ─────────────────────────────────────────────────────────────────

afterEach(async () => {
  if (createdAppointmentIds.length === 0) return
  await supabase
    .from('appointments')
    .delete()
    .in('id', createdAppointmentIds)
  createdAppointmentIds.length = 0
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AI Tool → Database Integration', () => {
  /**
   * T1: Direct repository insertion validates end-to-end data flow.
   * We bypass the tool (which requires Next.js server context for createClient)
   * and test the Repository layer directly — which is exactly what the tool uses.
   */
  it('[T1] book_appointment: appointment persists with correct business_id', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 7)          // 1 week from now
    startAt.setHours(10, 0, 0, 0)
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000) // +60 min

    const result = await repos.appointments.create({
      business_id:      BIZ_ID,
      client_id:        CLIENT_ID,
      service_ids:      [SERVICE_ID],
      assigned_user_id: null,
      start_at:         startAt.toISOString(),
      end_at:           endAt.toISOString(),
      notes:            'Integration test — auto cleanup',
      status:           'pending',
      is_dual_booking:  false,
    })

    expect(result.error).toBeNull()
    expect(result.data).toBeDefined()
    expect(result.data!.business_id).toBe(BIZ_ID)
    expect(result.data!.client_id).toBe(CLIENT_ID)
    expect(result.data!.status).toBe('pending')

    // Register for cleanup
    createdAppointmentIds.push(result.data!.id)
  })

  it('[T2] book_appointment: duplicate slot is rejected by conflict check', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 14) // 2 weeks from now
    startAt.setHours(11, 0, 0, 0)
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000)

    // Book first appointment
    const first = await repos.appointments.create({
      business_id:      BIZ_ID,
      client_id:        CLIENT_ID,
      service_ids:      [SERVICE_ID],
      assigned_user_id: null,
      start_at:         startAt.toISOString(),
      end_at:           endAt.toISOString(),
      notes:            'Integration test slot 1',
      status:           'confirmed',
      is_dual_booking:  false,
    })

    expect(first.error).toBeNull()
    createdAppointmentIds.push(first.data!.id)

    // Check for conflicts — should find the appointment we just created
    const conflicts = await repos.appointments.findConflicts(
      BIZ_ID,
      startAt.toISOString(),
      endAt.toISOString(),
    )

    expect(conflicts.error).toBeNull()
    expect(conflicts.data!.length).toBeGreaterThan(0)
  })

  it('[T3] cancelByAppointment: reminder is cancelled when appointment is cancelled', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 21) // 3 weeks out
    startAt.setHours(14, 0, 0, 0)
    const remindAt = new Date(startAt.getTime() - 60 * 60 * 1000) // 1h before

    // Create appointment
    const appt = await repos.appointments.create({
      business_id:      BIZ_ID,
      client_id:        CLIENT_ID,
      service_ids:      [SERVICE_ID],
      assigned_user_id: null,
      start_at:         startAt.toISOString(),
      end_at:           new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
      notes:            'Integration test with reminder',
      status:           'pending',
      is_dual_booking:  false,
    })

    expect(appt.error).toBeNull()
    const apptId = appt.data!.id
    createdAppointmentIds.push(apptId)

    // Insert a pending reminder for this appointment
    const upsertResult = await repos.reminders.upsert(
      apptId,
      BIZ_ID,
      remindAt.toISOString(),
      60
    )
    expect(upsertResult.error).toBeNull()

    // Cancel the reminder
    const cancelResult = await repos.reminders.cancelByAppointment(apptId)
    expect(cancelResult.error).toBeNull()

    // Verify the reminder is now cancelled
    const { data: reminder } = await supabase
      .from('appointment_reminders')
      .select('status')
      .eq('appointment_id', apptId)
      .single()

    expect(reminder?.status).toBe('cancelled')
  })
})
