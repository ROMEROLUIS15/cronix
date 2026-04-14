/**
 * calendar-visual.spec.ts — Phase 5: Visual Sync & Presence
 *
 * Validates that after a booking is created, it is correctly reflected
 * in the Appointments calendar view for the authenticated user.
 *
 * Depends on: auth.setup.ts (saved browser state)
 * Depends on: scripts/setup-e2e-data.ts (test client + service in DB)
 *
 * Run with: npx playwright test tests/e2e/calendar-visual.spec.ts
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ── Helpers ─────────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY    ?? ''
const TEST_SLUG        = 'e2e-test'

/** Inserts a test appointment via service-role and returns its ID for cleanup. */
async function seedAppointment(): Promise<{ id: string; clientName: string }> {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', TEST_SLUG)
    .single()

  if (!biz) throw new Error('E2E business not found. Run setup-e2e-data.ts first.')

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('business_id', biz.id)
    .limit(1)
    .single()

  const { data: service } = await supabase
    .from('services')
    .select('id, duration_min')
    .eq('business_id', biz.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!client || !service) throw new Error('Missing test client or service.')

  // Create appointment for TODAY so it appears in the default view
  const startAt = new Date()
  startAt.setHours(14, 0, 0, 0) // 2 PM today
  const endAt = new Date(startAt.getTime() + (service.duration_min ?? 60) * 60 * 1000)

  const { data: appt, error } = await supabase
    .from('appointments')
    .insert({
      business_id:     biz.id,
      client_id:       client.id,
      service_id:      service.id,
      start_at:        startAt.toISOString(),
      end_at:          endAt.toISOString(),
      status:          'pending',
      notes:           'Visual E2E test — auto cleanup',
      is_dual_booking: false,
    })
    .select('id')
    .single()

  if (error || !appt) throw new Error(`Failed to seed appointment: ${error?.message}`)
  return { id: appt.id, clientName: client.name }
}

async function deleteAppointment(id: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  await supabase.from('appointments').delete().eq('id', id)
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Calendar Visual Sync', () => {
  let appointmentId = ''
  let clientName    = ''

  test.beforeAll(async () => {
    try {
      const seeded = await seedAppointment()
      appointmentId = seeded.id
      clientName    = seeded.clientName
      console.log(`✅ Seeded test appointment: ${clientName} (${appointmentId})`)
    } catch (error) {
      console.warn('⚠️  Failed to seed appointment, skipping calendar tests:', error)
      // Skip tests if seeding fails
      test.skip()
    }
  })

  test.afterAll(async () => {
    if (appointmentId) {
      await deleteAppointment(appointmentId)
      console.log(`✅ Cleaned up test appointment: ${appointmentId}`)
    }
  })

  test('[V1] seeded appointment appears on the appointments list', async ({ page }) => {
    test.skip(!clientName, 'No test client available')

    await page.goto('/dashboard/appointments')
    await page.waitForURL(/\/appointments/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 })

    const clientLocator = page.getByText(clientName, { exact: false }).first()
    await expect(clientLocator).toBeVisible({ timeout: 15_000 })
  })

  test('[V2] appointment card shows "pending" status indicator', async ({ page }) => {
    test.skip(!clientName, 'No test client available')

    await page.goto('/dashboard/appointments')
    await page.waitForURL(/\/appointments/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 })

    const card = page.locator('[data-testid="appointment-card"]', {
      has: page.getByText(clientName, { exact: false })
    }).or(
      page.locator('li, article, div').filter({
        has: page.getByText(clientName, { exact: false })
      }).first()
    )

    const statusChip = card.getByText(/pendiente|pending|por confirmar/i).first()
    await expect(statusChip).toBeVisible({ timeout: 10_000 })
  })

  test('[V3] clicking an appointment opens its detail without error', async ({ page }) => {
    test.skip(!clientName, 'No test client available')

    await page.goto('/dashboard/appointments')
    await page.waitForURL(/\/appointments/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 })

    const clientLink = page.getByText(clientName, { exact: false }).first()
    await expect(clientLink).toBeVisible({ timeout: 15_000 })
    await clientLink.click()

    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    const errorIndicator = page.getByText(/error|500|not found/i).first()
    await expect(errorIndicator).not.toBeVisible({ timeout: 5_000 })
  })
})
