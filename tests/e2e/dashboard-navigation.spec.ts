import { test, expect } from '@playwright/test'

/**
 * Dashboard Navigation — E2E
 *
 * Runs under the `chromium` project which injects a pre-authenticated
 * storageState via auth.setup.ts. No manual login is needed here.
 * Direct URL navigation is used instead of sidebar clicks to avoid
 * fragile text-based locators that break with locale/translation changes.
 */
test.describe('Dashboard Navigation', () => {
  test('should load dashboard when authenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
    expect(page.url()).toContain('/dashboard')
  })

  test('should load settings page', async ({ page }) => {
    await page.goto('/dashboard/settings')
    await page.waitForURL(/\/settings/, { timeout: 20_000 })
    expect(page.url()).toContain('/settings')
  })

  test('should load finances page', async ({ page }) => {
    await page.goto('/dashboard/finances')
    await page.waitForURL(/\/finances/, { timeout: 20_000 })
    expect(page.url()).toContain('/finances')
  })

  test('should load reports page', async ({ page }) => {
    await page.goto('/dashboard/reports')
    await page.waitForURL(/\/reports/, { timeout: 20_000 })
    expect(page.url()).toContain('/reports')
  })

  test('should redirect unauthenticated user to login', async ({ browser }) => {
    // Explicitly create a context with no storageState to simulate unauthenticated access
    const context = await browser.newContext({ storageState: undefined })
    const newPage = await context.newPage()

    try {
      await newPage.goto('/dashboard')
      await newPage.waitForURL(/\/login/, { timeout: 15_000 })
      expect(newPage.url()).toContain('/login')
    } finally {
      await context.close()
    }
  })
})
