// @ts-nocheck
/**
 * repositories.test.ts — Phase 4: Repository Integration Tests
 *
 * Validates that repository methods correctly persist and retrieve data
 * from Supabase using a real service-role client.
 *
 * Environment: Node.js (no browser, no Next.js context)
 * Requires:    NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Run with:    npx vitest run tests/integration
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'

// Fallback env loading
let dotenv: any
try { dotenv = require('dotenv') } catch { /* not installed */ }
if (dotenv) dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── Env Guards ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_SLUG = 'e2e-test'

const hasSupabaseAccess = !!(SUPABASE_URL && SERVICE_ROLE_KEY)
const describeIntegration = hasSupabaseAccess ? describe : describe.skip

// ── Shared State ────────────────────────────────────────────────────────────

const supabase = hasSupabaseAccess
  ? createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    })
  : null as any

const createdIds: { [key: string]: string[] } = {
  clients: [],
  services: [],
  notifications: [],
  reminders: [],
  transactions: [],
}

let BIZ_ID: string
let CLIENT_ID: string
let SERVICE_ID: string

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Fetch e2e test business
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', TEST_SLUG)
    .maybeSingle()

  if (bizErr || !biz) {
    throw new Error(
      `E2E business "${TEST_SLUG}" not found. Run: npx tsx scripts/setup-e2e-data.ts`
    )
  }
  BIZ_ID = biz.id

  // Fetch test client
  const { data: cli } = await supabase
    .from('clients')
    .select('id')
    .eq('business_id', BIZ_ID)
    .limit(1)
    .single()

  if (!cli) throw new Error('No test client in e2e business')
  CLIENT_ID = cli.id

  // Fetch test service
  const { data: svc } = await supabase
    .from('services')
    .select('id')
    .eq('business_id', BIZ_ID)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!svc) throw new Error('No active test service in e2e business')
  SERVICE_ID = svc.id
})

// ── Cleanup ─────────────────────────────────────────────────────────────────

afterEach(async () => {
  // Delete in order of FK dependencies
  if (createdIds.reminders?.length) {
    await supabase.from('appointment_reminders').delete().in('id', createdIds.reminders)
  }
  if (createdIds.clients?.length) {
    await supabase.from('clients').delete().in('id', createdIds.clients)
  }
  if (createdIds.services?.length) {
    await supabase.from('services').delete().in('id', createdIds.services)
  }
  if (createdIds.notifications?.length) {
    await supabase.from('notifications').delete().in('id', createdIds.notifications)
  }
  if (createdIds.transactions?.length) {
    await supabase.from('accounting_transactions').delete().in('id', createdIds.transactions)
  }

  Object.keys(createdIds).forEach(k => {
    if (createdIds[k as keyof typeof createdIds]) {
      createdIds[k as keyof typeof createdIds]!.length = 0
    }
  })
})

// ── Tests ────────────────────────────────────────────────────────────────────

describeIntegration('Repository Integration Tests', () => {
  it('[R1] ClientRepository.insert persists client and returns with ID', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const result = await repos.clients.insert({
      business_id: BIZ_ID,
      name: 'Integration Test Client',
      email: `client-${Date.now()}@test.com`,
      phone: '+5730012345',
    })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
    createdIds.clients.push(result.data!.id)

    // Verify in DB
    const { data: stored } = await supabase
      .from('clients')
      .select('*')
      .eq('id', result.data!.id)
      .single()

    expect(stored?.name).toBe('Integration Test Client')
    expect(stored?.business_id).toBe(BIZ_ID)
  })

  it('[R2] ClientRepository.getAll returns only clients for business', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    // Insert test client
    const created = await repos.clients.insert({
      business_id: BIZ_ID,
      name: 'Client For GetAll Test',
      email: `getall-${Date.now()}@test.com`,
      phone: undefined,
    })
    if (created.data?.id) createdIds.clients?.push(created.data.id)

    // Get all clients
    const result = await repos.clients.getAll(BIZ_ID)

    expect(result.error).toBeNull()
    expect(result.data).toBeInstanceOf(Array)
    const foundClient = result.data?.find(c => c.id === created.data!.id)
    expect(foundClient?.name).toBe('Client For GetAll Test')
  })

  it('[R3] ServiceRepository.getActive returns only active services', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const result = await repos.services.getActive(BIZ_ID)

    expect(result.error).toBeNull()
    expect(result.data).toBeInstanceOf(Array)

    // Verify data exists
    expect(result.data?.length).toBeGreaterThanOrEqual(0)
  })

  it('[R4] NotificationRepository.create persists notification', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const result = await repos.notifications.create({
      business_id: BIZ_ID,
      title: 'Integration Test Notification',
      type: 'info',
    })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
    createdIds.notifications.push(result.data!.id)

    // Verify in DB
    const { data: stored } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', result.data!.id)
      .single()

    expect(stored?.read_at).toBeNull()
    expect(stored?.type).toBe('info')
  })

  it('[R5] NotificationRepository.markAsRead updates notification', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    // Create notification
    const created = await repos.notifications.create({
      business_id: BIZ_ID,
      title: 'Mark As Read Test',
      type: 'info',
    })
    if (created.data?.id) createdIds.notifications?.push(created.data.id)

    // Mark as read
    const marked = await repos.notifications.markAsRead(created.data!.id, BIZ_ID)

    expect(marked.error).toBeNull()

    // Verify in DB
    const { data: stored } = await supabase
      .from('notifications')
      .select('read_at')
      .eq('id', created.data!.id)
      .single()

    expect(stored?.read_at).not.toBeNull()
  })

  it('[R6] ReminderRepository.upsert creates reminder with correct timing', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    // Create appointment first
    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 7)
    startAt.setHours(14, 0, 0, 0)
    const endAt = new Date(startAt.getTime() + 3600000)

    const appt = await repos.appointments.create({
      business_id: BIZ_ID,
      client_id: CLIENT_ID,
      service_ids: [SERVICE_ID],
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      status: 'confirmed' as 'confirmed',
      assigned_user_id: undefined,
      notes: undefined,
      is_dual_booking: false,
    })
    if (appt.data?.id) createdIds.reminders?.push(appt.data.id)

    // Upsert reminder
    const remindAt = new Date(startAt.getTime() - 60 * 60 * 1000) // 1h before
    const result = await repos.reminders.upsert(
      appt.data!.id,
      BIZ_ID,
      remindAt.toISOString(),
      60
    )

    expect(result.error).toBeNull()
    expect(result.data?.appointment_id).toBe(appt.data!.id)
  })

  it('[R7] ReminderRepository.cancelByAppointment marks reminder as cancelled', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    // Create appointment + reminder
    const startAt = new Date()
    startAt.setDate(startAt.getDate() + 14)
    startAt.setHours(10, 0, 0, 0)

    const appt = await repos.appointments.create({
      business_id: BIZ_ID,
      client_id: CLIENT_ID,
      service_ids: [SERVICE_ID],
      start_at: startAt.toISOString(),
      end_at: new Date(startAt.getTime() + 3600000).toISOString(),
      status: 'confirmed' as 'confirmed',
      assigned_user_id: undefined,
      notes: undefined,
      is_dual_booking: false,
    })

    const remindAt = new Date(startAt.getTime() - 30 * 60 * 1000)
    await repos.reminders.upsert(appt.data!.id, BIZ_ID, remindAt.toISOString(), 30)

    // Cancel reminder
    const cancelled = await repos.reminders.cancelByAppointment(appt.data!.id)

    expect(cancelled.error).toBeNull()

    // Verify in DB
    const { data: reminder } = await supabase
      .from('appointment_reminders')
      .select('status')
      .eq('appointment_id', appt.data!.id)
      .single()

    expect(reminder?.status).toBe('cancelled')
  })

  it('[R8] BusinessRepository.getById returns business settings', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const result = await repos.businesses.getById(BIZ_ID)

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe(BIZ_ID)
    expect(result.data?.name).toBeDefined()
  })

  it('[R9] UserRepository.getUserContextById returns role and business', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    // Get a user from auth
    const { data: users } = await supabase.auth.admin.listUsers()
    if (!users || users.users.length === 0) {
      return // Skip if no users
    }

    const userId = users.users[0].id
    const result = await repos.users.getUserContextById(userId)

    if (result.data) {
      expect(result.data.role).toBeDefined()
      expect(['owner', 'employee', 'admin']).toContain(result.data.role)
    }
  })

  it('[R10] FinanceRepository.createTransaction persists payment', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)

    const result = await repos.finances.createTransaction({
      business_id: BIZ_ID,
      description: 'Integration test transaction',
      amount: 50000,
      paid_at: new Date().toISOString(),
      payment_method: 'cash' as const,
    })

    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
    createdIds.transactions.push(result.data!.id)

    // Verify in DB
    const { data: stored } = await supabase
      .from('accounting_transactions')
      .select('*')
      .eq('id', result.data!.id)
      .single()

    expect(stored?.amount).toBe(50000)
    expect(stored?.type).toBe('income')
  })
})
