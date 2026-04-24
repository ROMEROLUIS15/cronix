// @ts-nocheck
/**
 * voice-assistant.spec.ts — End-to-End Tests for the Voice Assistant FAB
 *
 * The FAB renders as two buttons sharing the same feature:
 *   - Mobile  (sm:hidden)  → data-testid="voice-assistant-fab-mobile"
 *   - Desktop (hidden sm:flex) → data-testid="voice-assistant-fab"
 *
 * CI runs Desktop Chrome (1280×720), so all tests target the desktop button.
 * The mobile button is CSS-hidden at that viewport and is tested separately if needed.
 *
 * Auth: uses the shared storageState from auth.setup.ts — NO manual login.
 * The component shows AFTER an async Supabase visibility check, so all locators
 * use a generous 10 s waitFor before interacting.
 *
 * IMPORTANT: The FAB is voice-only. There is no text-input chat interface.
 * Tests validate the button's DOM state, not audio I/O (CI has no microphone).
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// Desktop FAB selector — visible at Desktop Chrome viewport (≥640 px).
// Mobile FAB (data-testid="voice-assistant-fab-mobile") is sm:hidden at this width.
const FAB_SELECTOR = '[data-testid="voice-assistant-fab"]'

test.describe('Voice Assistant E2E', () => {
  // chromium project injects an authenticated session via playwright/.auth/user.json
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
  })

  // ── VA1 ─────────────────────────────────────────────────────────────────────
  test('[VA1] Voice FAB (desktop) is visible after async visibility check', async ({ page }) => {
    // The component renders null until supabase.from('businesses') resolves.
    // Wait explicitly for the desktop button to be in the DOM and visible.
    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(fab).toBeVisible()
    await expect(fab).toBeEnabled()
  })

  // ── VA2 ─────────────────────────────────────────────────────────────────────
  test('[VA2] Clicking FAB does not crash the page', async ({ page }) => {
    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    // Click the FAB — in CI (no mic) the component shows a status message
    // or stays idle. Either way the page must not navigate away or throw.
    await fab.click()
    await page.waitForTimeout(1_000)

    // The FAB must still be visible (not unmounted, no crash)
    await expect(fab).toBeVisible()
    // Page URL must not have changed (no redirect triggered by click)
    expect(page.url()).toContain('/dashboard')
  })

  // ── VA3 ─────────────────────────────────────────────────────────────────────
  test('[VA3] FAB has correct aria-label containing "Luis"', async ({ page }) => {
    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    const ariaLabel = await fab.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel).toContain('Luis')
  })

  // ── VA4 ─────────────────────────────────────────────────────────────────────
  test('[VA4] FAB survives multiple rapid clicks without unmounting', async ({ page }) => {
    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 10_000 })

    for (let i = 0; i < 3; i++) {
      await fab.click()
      await page.waitForTimeout(300)
    }

    // Must still be in the DOM and visible after rapid clicks
    await expect(fab).toBeVisible()
  })

  // ── VA5 ─────────────────────────────────────────────────────────────────────
  test('[VA5] FAB is present on appointments sub-page', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/appointments`)
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    // The FAB is mounted in dashboard/layout.tsx, so it appears on all sub-pages
    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 8_000 })
    await expect(fab).toBeVisible()
  })

  // ── VA6 ─────────────────────────────────────────────────────────────────────
  test('[VA6] FAB is present on clients sub-page', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/clients`)
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })

    const fab = page.locator(FAB_SELECTOR)
    await fab.waitFor({ state: 'visible', timeout: 8_000 })
    await expect(fab).toBeVisible()
  })
})
