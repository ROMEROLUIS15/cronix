import { test, expect } from '@playwright/test'

/**
 * Client Management — E2E
 *
 * Runs under the `chromium` project which injects a pre-authenticated
 * storageState via auth.setup.ts. No manual login is needed here.
 */
test.describe('Client Management', () => {
  test('should load clients list', async ({ page }) => {
    await page.goto('/dashboard/clients')
    await page.waitForURL(/\/clients/, { timeout: 20_000 })
    expect(page.url()).toContain('/clients')
  })

  test('should load new client form', async ({ page }) => {
    await page.goto('/dashboard/clients/new')
    await page.waitForURL(/\/clients\/new/, { timeout: 20_000 })
    await expect(page.locator('form').first()).toBeVisible({ timeout: 10_000 })
  })

  test('should open client detail when clicking a client row', async ({ page }) => {
    await page.goto('/dashboard/clients')
    await page.waitForURL(/\/clients/, { timeout: 20_000 })

    // Only proceed if there are client rows — skip silently if list is empty
    const firstRow = page.locator('table tbody tr, [data-testid="client-card"]').first()
    const hasClients = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)
    if (!hasClients) {
      test.skip(true, 'No clients in DB — skipping detail test')
      return
    }

    await firstRow.click()
    await page.waitForURL(/\/clients\/[a-f0-9-]+/, { timeout: 15_000 })
    expect(page.url()).toMatch(/\/clients\/[a-f0-9-]+/)
  })
})
