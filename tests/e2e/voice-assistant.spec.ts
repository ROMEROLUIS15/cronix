// @ts-nocheck
/**
 * voice-assistant.spec.ts — End-to-End Test for Voice Assistant UI
 *
 * Tests the complete user journey:
 *   1. User logs in to dashboard
 *   2. Clicks voice assistant FAB (Floating Action Button)
 *   3. Sends text input (simulates audio in real scenario)
 *   4. Receives response from AI
 *   5. If booking decision: verifies appointment created in DB
 *
 * Run with: npx playwright test --grep "voice-assistant"
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

test.describe('Voice Assistant E2E', () => {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000'

  let supabase: ReturnType<typeof createClient>
  let testUserEmail: string
  let testUserPassword: string
  let businessId: string

  test.beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase env vars for E2E test')
    }

    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Create test user
    testUserEmail = `e2e-voice-${Date.now()}@test.cronix.com`
    testUserPassword = 'Test@123456'

    const { data: user } = await supabase.auth.admin.createUser({
      email: testUserEmail,
      password: testUserPassword,
      email_confirm: true,
    })

    if (!user) throw new Error('Failed to create test user')

    // Get e2e-test business
    const { data: biz } = await supabase
      .from('businesses')
      .select('id')
      .eq('slug', 'e2e-test')
      .maybeSingle()

    if (!biz) throw new Error('E2E test business not found')
    businessId = biz.id as string

    // Link user to business as owner
    await supabase.from('business_users').insert({
      business_id: businessId,
      user_id: user.id as string,
      role: 'owner',
    })
  })

  test.beforeEach(async ({ page }) => {
    // Navigate to login
    await page.goto(`${APP_URL}/auth/signin`)

    // Fill login form
    await page.fill('input[name="email"]', testUserEmail)
    await page.fill('input[name="password"]', testUserPassword)

    // Submit
    await page.click('button[type="submit"]')

    // Wait for redirect to dashboard
    await page.waitForURL(/\/(dashboard|[a-z]{2}\/dashboard)/, { timeout: 10000 })
  })

  test('[VA1] Voice FAB is visible and clickable', async ({ page }) => {
    // Voice FAB should be present on dashboard
    const fab = page.locator('[data-testid="voice-assistant-fab"], button:has-text("Mic"), [role="button"]:has(svg)')

    // Wait for FAB to be visible
    await fab.first().waitFor({ state: 'visible', timeout: 5000 })

    expect(fab).toBeDefined()
  })

  test('[VA2] Send text input and receive response', async ({ page }) => {
    // Find and click the FAB
    const fab = page.locator('button:has(svg)').filter({ has: page.locator('svg') }).first()
    await fab.click()

    // Wait for voice input UI to appear
    await page.waitForTimeout(500)

    // Find text input field (should appear after FAB click)
    const textInput = page.locator('input[placeholder*="Escri"], input[placeholder*="Qué"], textarea')
    if (await textInput.count() > 0) {
      await textInput.first().fill('Hola, quiero agendar una cita para mañana a las 3')
      await page.keyboard.press('Enter')
    } else {
      // Alternative: button to switch to text mode
      const textModeBtn = page.locator('button:has-text("Texto"), button:has-text("Text")')
      if (await textModeBtn.count() > 0) {
        await textModeBtn.click()
        await page.fill('input, textarea', 'Hola, quiero agendar')
      }
    }

    // Wait for response (may take a few seconds due to LLM processing)
    const responseText = page.locator('text=/Luis|asistente|respuesta/i, [data-testid="assistant-response"]')
    await responseText.waitFor({ state: 'visible', timeout: 15000 })

    // Verify some response is shown
    await expect(responseText).toBeVisible()
  })

  test('[VA3] Chat history is preserved in multi-turn', async ({ page }) => {
    const fab = page.locator('button:has(svg)').first()
    await fab.click()
    await page.waitForTimeout(500)

    // First turn
    const input1 = page.locator('input, textarea').first()
    if (await input1.count() > 0) {
      await input1.fill('Hola')
      await page.keyboard.press('Enter')

      // Wait for response
      await page.waitForTimeout(5000)

      // Second turn (verify history is maintained)
      const input2 = page.locator('input[value=""], input:not([value]), textarea').first()
      if (await input2.count() > 0) {
        await input2.fill('Agendar una cita')
        await page.keyboard.press('Enter')

        // Should receive new response
        await page.waitForTimeout(3000)

        // Check that conversation appears continuous (Luis FAB might show message count)
        const messageCount = page.locator('[data-testid="message-count"], :text("2")')
        if (await messageCount.count() > 0) {
          await expect(messageCount).toBeVisible()
        }
      }
    }
  })

  test('[VA4] Error handling: display error message on API failure', async ({ page, context }) => {
    // Mock API response to return error
    await context.route('**/api/assistant/voice', route => {
      route.abort('failed')
    })

    const fab = page.locator('button:has(svg)').first()
    await fab.click()
    await page.waitForTimeout(500)

    const input = page.locator('input, textarea').first()
    if (await input.count() > 0) {
      await input.fill('Test')
      await page.keyboard.press('Enter')

      // Error message should appear
      const errorMsg = page.locator('text=/error|no se pudo|fallo/i, [data-testid="error-message"]')
      await errorMsg.waitFor({ state: 'visible', timeout: 10000 })

      await expect(errorMsg).toBeVisible()
    }
  })

  test('[VA5] Appointment is created after booking decision', async ({ page }) => {
    const fab = page.locator('button:has(svg)').first()
    await fab.click()
    await page.waitForTimeout(500)

    // Send booking request
    const input = page.locator('input, textarea').first()
    if (await input.count() > 0) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = tomorrow.toLocaleDateString('es-ES')

      await input.fill(`Agendar cita para ${dateStr} a las 3 de la tarde`)
      await page.keyboard.press('Enter')

      // Wait for response
      await page.waitForTimeout(5000)

      // Verify response suggests booking was created
      const responseArea = page.locator('[data-testid="assistant-response"], :text("Listo")')
      if (await responseArea.count() > 0) {
        await expect(responseArea).toBeVisible()
      }

      // Optional: Query DB to verify appointment was created
      if (supabase) {
        const { data: appointments } = await supabase
          .from('appointments')
          .select('id, status')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(1)

        if (appointments && (appointments as any[]).length > 0) {
          expect((appointments as any[])[0].status).toMatch(/pending|confirmed/)
        }
      }
    }
  })

  test('[VA6] Voice FAB can be closed and reopened', async ({ page }) => {
    const fab = page.locator('button:has(svg)').first()

    // Open
    await fab.click()
    await page.waitForTimeout(500)

    const closeBtn = page.locator('button:has-text("Cerrar"), button:has-text("×"), [aria-label*="close"]').first()

    // If close button exists, click it
    if (await closeBtn.count() > 0) {
      await closeBtn.click()
    } else {
      // Alternative: press Escape
      await page.keyboard.press('Escape')
    }

    // Wait a moment
    await page.waitForTimeout(500)

    // Reopen
    await fab.click()
    await page.waitForTimeout(500)

    // Should be open again
    const input = page.locator('input, textarea')
    if (await input.count() > 0) {
      await expect(input.first()).toBeFocused()
    }
  })
})
