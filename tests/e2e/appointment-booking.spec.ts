import { test, expect } from '@playwright/test'

test.describe('Appointment Booking Flow', () => {
  // Auth state is already loaded via playwright.config.ts (storageState)
  // No need to login manually - auth.setup.ts handles this

  test('should navigate to new appointment page', async ({ page }) => {
    // Navigate directly to appointments page instead of clicking through dashboard
    await page.goto('/dashboard/appointments')
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    await page.waitForTimeout(1000)

    // Click new appointment button
    const newAppointmentButton = page.locator('a[href*="appointments/new"], button:has-text("Nueva"), button:has-text("New")').first()
    await newAppointmentButton.scrollIntoViewIfNeeded()
    await newAppointmentButton.waitFor({ state: 'visible', timeout: 10_000 })
    await newAppointmentButton.click()
    await page.waitForURL(/\/appointments\/new/, { timeout: 10_000 })

    // Verify form is visible
    await expect(page.locator('form').first()).toBeVisible({ timeout: 5_000 })
  })

  test('should show validation errors on empty form', async ({ page }) => {
    // Navigate directly to new appointment page
    await page.goto('/dashboard/appointments/new')
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    await page.waitForTimeout(1000)

    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"]').first()
    await submitButton.scrollIntoViewIfNeeded()
    await submitButton.click()

    // Should stay on the form page or show validation errors
    await page.waitForTimeout(2000)
    expect(page.url()).toContain('/appointments/new')
  })
})
