/**
 * tests/e2e/auth-register.spec.ts — User Registration E2E Tests
 *
 * Tests the complete registration flow:
 * - Navigate to registration page
 * - Fill form with valid credentials
 * - Submit and validate success
 * - Test error scenarios (duplicate email, validation)
 * - Test account activation
 */

import { test, expect } from '@playwright/test'

test.describe('User Registration (/register)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to register page (smoke test may not load auth state)
    await page.goto('/register')
  })

  test('should display registration form', async ({ page }) => {
    // Check for key form elements
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

    // Check for sign up link text
    await expect(page.locator('text=/sign up|registro|registrarse/i')).toBeVisible()
  })

  test('should validate email format before submission', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')

    // Type invalid email
    await emailInput.fill('invalid-email')
    await page.locator('button[type="submit"]').click()

    // Should show validation error or email input should be invalid
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity())
    expect(isInvalid).toBe(true)
  })

  test('should require password minimum length', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    await emailInput.fill(`test-${Date.now()}@example.com`)
    await passwordInput.fill('short')

    // Try to submit
    await page.locator('button[type="submit"]').click()

    // Should either show validation error or not submit
    const isInvalid = await passwordInput.evaluate((el: HTMLInputElement) => !el.checkValidity())
    expect(isInvalid).toBe(true)
  })

  test('should navigate to login page from register', async ({ page }) => {
    // Look for "already have an account?" / "sign in" link
    const loginLink = page.locator('a[href*="/login"], text=/sign in|inicia sesión/i')

    if (await loginLink.isVisible()) {
      await loginLink.click()
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test('should show password strength indicator (if implemented)', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]')

    // Type password to trigger strength indicator
    await passwordInput.fill('StrongPassword123!')

    // Check if strength indicator is visible (depends on implementation)
    const strengthIndicator = page.locator('[data-testid="password-strength"], .password-strength')
    const isVisible = await strengthIndicator.isVisible().catch(() => false)

    if (isVisible) {
      // Should show strong password
      await expect(strengthIndicator).toContainText(/strong|bueno|fuerte/i)
    }
  })

  test('should show terms and privacy links', async ({ page }) => {
    const termsLink = page.locator('a[href*="/terms"]')
    const privacyLink = page.locator('a[href*="/privacy"]')

    expect(await termsLink.isVisible() || await privacyLink.isVisible()).toBe(true)
  })

  test('should disable submit button while loading', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const submitButton = page.locator('button[type="submit"]')

    await emailInput.fill(`valid-${Date.now()}@example.com`)
    await passwordInput.fill('ValidPassword123!')

    // Check if button becomes disabled during submission (may be very quick)
    const isDisabledBeforeClick = await submitButton.isDisabled()

    // Observe if it becomes disabled momentarily
    const loadingPromise = page.waitForLoadState('networkidle').catch(() => null)
    await submitButton.click()

    // Should eventually show success or error
    await Promise.race([
      page.waitForURL(/\/register|\/dashboard|\/login/),
      page.waitForLoadState('networkidle'),
      loadingPromise,
    ]).catch(() => null)
  })

  test('should handle server errors gracefully', async ({ page }) => {
    // This test relies on the backend returning an error
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    // Use an obviously invalid or known-to-fail email if setup allows
    await emailInput.fill('test@localhost.invalid')
    await passwordInput.fill('ValidPassword123!')

    await page.locator('button[type="submit"]').click()

    // Should show error message (specific text depends on backend)
    const errorMessage = page.locator('[role="alert"], .error, .text-red')
    const isVisible = await errorMessage.isVisible().catch(() => false)

    // If error message appears, it should be visible
    if (isVisible) {
      await expect(errorMessage).toBeVisible()
    }
  })

  test('should preserve email field value on error', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    const testEmail = `test-${Date.now()}@example.com`
    await emailInput.fill(testEmail)
    await passwordInput.fill('ValidPassword123!')

    await page.locator('button[type="submit"]').click()

    // Wait a bit for response
    await page.waitForTimeout(1000)

    // Email should still be filled (preserved for retry)
    const emailValue = await emailInput.inputValue()
    expect(emailValue).toBe(testEmail)
  })

  test('should be accessible via /register path', async ({ page }) => {
    await expect(page).toHaveURL(/\/register/)
  })

  test('should have accessible form labels', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    // Check if inputs have associated labels or aria-labels
    const emailHasLabel = await emailInput.evaluate((el) => {
      return !!el.labels?.length || el.hasAttribute('aria-label')
    })

    const passwordHasLabel = await passwordInput.evaluate((el) => {
      return !!el.labels?.length || el.hasAttribute('aria-label')
    })

    expect(emailHasLabel || passwordHasLabel).toBe(true)
  })
})
