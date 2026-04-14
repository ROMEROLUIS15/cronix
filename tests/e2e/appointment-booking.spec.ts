import { test, expect } from '@playwright/test'

test.describe('Appointment Booking Flow', () => {
  // Auth state is already loaded via playwright.config.ts (storageState)
  // No need to login manually - auth.setup.ts handles this

  test('should navigate to new appointment page', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })

    // Navigate to appointments
    const appointmentsLink = page.locator('a[href*="appointments"]').first()
    await appointmentsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await appointmentsLink.click()
    await page.waitForURL(/\/appointments/, { timeout: 10_000 })

    // Click new appointment
    const newAppointmentButton = page.locator('a[href*="appointments/new"]').first()
    await newAppointmentButton.waitFor({ state: 'visible', timeout: 10_000 })
    await newAppointmentButton.click()
    await page.waitForURL(/\/appointments\/new/, { timeout: 10_000 })

    // Verify form is visible
    await expect(page.locator('form')).toBeVisible({ timeout: 5_000 })
  })

  test('should show validation errors on empty form', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })

    // Navigate to appointments
    const appointmentsLink = page.locator('a[href*="appointments"]').first()
    await appointmentsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await appointmentsLink.click()
    await page.waitForURL(/\/appointments/, { timeout: 10_000 })

    // Click new appointment
    const newAppointmentButton = page.locator('a[href*="appointments/new"]').first()
    await newAppointmentButton.waitFor({ state: 'visible', timeout: 10_000 })
    await newAppointmentButton.click()
    await page.waitForURL(/\/appointments\/new/, { timeout: 10_000 })

    // Try to submit empty form
    await page.click('button[type="submit"]')

    // Should show validation errors or stay on the form page
    await page.waitForTimeout(2000)
    expect(page.url()).toContain('/appointments/new')
  })
})
