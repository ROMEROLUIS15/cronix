import { test, expect } from '@playwright/test'

/**
 * Appointment Booking — E2E
 *
 * Runs under the `chromium` project which injects a pre-authenticated
 * storageState via auth.setup.ts. No manual login is needed here.
 */
test.describe('Appointment Booking Flow', () => {
  test('should load appointments page', async ({ page }) => {
    await page.goto('/dashboard/appointments')
    await page.waitForURL(/\/appointments/, { timeout: 20_000 })
    expect(page.url()).toContain('/appointments')
  })

  test('should load new appointment form', async ({ page }) => {
    await page.goto('/dashboard/appointments/new')
    await page.waitForURL(/\/appointments\/new/, { timeout: 20_000 })
    await expect(page.locator('form').first()).toBeVisible({ timeout: 10_000 })
  })

  test('should stay on form page after empty submit', async ({ page }) => {
    await page.goto('/dashboard/appointments/new')
    await page.waitForURL(/\/appointments\/new/, { timeout: 20_000 })
    await expect(page.locator('form').first()).toBeVisible({ timeout: 10_000 })

    const submitButton = page.locator('button[type="submit"]').first()
    await submitButton.scrollIntoViewIfNeeded()
    await submitButton.click()

    // Validation (HTML5 native or inline) should keep us on the same page
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 })
    expect(page.url()).toContain('/appointments/new')
  })
})
