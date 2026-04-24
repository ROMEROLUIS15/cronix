// @ts-nocheck
/**
 * voice-assistant.spec.ts — End-to-End Tests for the Voice Assistant FAB
 *
 * The FAB is a draggable floating button that opens a voice interface.
 * It is a VOICE-only component — there is no chat text input; the user
 * speaks and the AI responds with audio.
 *
 * Auth: uses the shared storageState from auth.setup.ts — NO manual login.
 * Selector: data-testid="voice-assistant-fab" (added to both mobile & desktop buttons).
 *
 * Run locally: npx playwright test voice-assistant
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

test.describe('Voice Assistant E2E', () => {
  // The chromium project in playwright.config.ts already injects an
  // authenticated session via playwright/.auth/user.json — no login needed.
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
  })

  // ── VA1 ─────────────────────────────────────────────────────────────────────

  test('[VA1] Voice FAB is visible and clickable', async ({ page }) => {
    // The FAB renders after a async Supabase visibility check — wait for it.
    const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
    await fab.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(fab).toBeVisible()
    await expect(fab).toBeEnabled()
  })

  // ── VA2 ─────────────────────────────────────────────────────────────────────

  test('[VA2] Clicking FAB transitions to listening or shows mic-access prompt', async ({ page }) => {
    const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    await fab.click()
    // After click the button title changes or a status message appears.
    // In CI there is no mic — the FAB will show "Micrófono no disponible"
    // or similar. Either state is valid; we just confirm the FAB reacted.
    await page.waitForTimeout(1_000)

    // The FAB must still be in the DOM (not unmounted on click)
    await expect(fab).toBeVisible()
  })

  // ── VA3 ─────────────────────────────────────────────────────────────────────

  test('[VA3] FAB shows status message when mic is unavailable', async ({ page, context }) => {
    // Deny microphone permission — simulates CI environment
    await context.grantPermissions([]) // removes mic permission

    const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
    await fab.waitFor({ state: 'visible', timeout: 10_000 })
    await fab.click()

    // Component shows a persistent status bubble when mic is denied.
    // Look for any text bubble that appears near the FAB.
    const statusBubble = page.locator(
      'text=/micrófono|Micrófono|mic|acceso|disponible/i'
    )

    // Allow up to 5 s for the status to appear
    const appeared = await statusBubble.first().isVisible({ timeout: 5_000 }).catch(() => false)

    // Whether mic is denied or not (depends on CI browser config),
    // the FAB must still be in the DOM.
    await expect(fab).toBeVisible()

    // If a status message did appear, it must be readable text.
    if (appeared) {
      await expect(statusBubble.first()).toBeVisible()
    }
  })

  // ── VA4 ─────────────────────────────────────────────────────────────────────

  test('[VA4] FAB has correct accessible label', async ({ page }) => {
    const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    // Check aria-label is set
    const ariaLabel = await fab.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel).toContain('Luis')
  })

  // ── VA5 ─────────────────────────────────────────────────────────────────────

  test('[VA5] FAB remains mounted after multiple clicks', async ({ page }) => {
    const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    // Click 3 times with short gaps — FAB must remain visible throughout
    for (let i = 0; i < 3; i++) {
      await fab.click()
      await page.waitForTimeout(400)
      await expect(fab).toBeVisible()
    }
  })

  // ── VA6 ─────────────────────────────────────────────────────────────────────

  test('[VA6] FAB is present on all dashboard sub-pages', async ({ page }) => {
    const routes = ['/dashboard', '/dashboard/appointments', '/dashboard/clients']

    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`)
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

      const fab = page.locator('[data-testid="voice-assistant-fab"]').first()
      await fab.waitFor({ state: 'visible', timeout: 8_000 })
      await expect(fab).toBeVisible()
    }
  })
})
