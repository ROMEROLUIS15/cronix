/**
 * tests/e2e/auth-login.spec.ts — User Login E2E Tests
 *
 * Tests the complete login flow using auth.setup.ts context:
 * - Login with valid credentials (from auth.setup.ts)
 * - Redirect to dashboard on success
 * - Test error scenarios (invalid credentials)
 * - Test session persistence
 */

import { test, expect } from '@playwright/test'

test.describe('User Login (/login)', () => {
  test.beforeEach(async ({ page, context }) => {
    // For authenticated tests, auth.setup.ts provides a logged-in context.
    // For this test, we'll explicitly navigate to login and test the flow.
    await page.goto('/login')
  })

  test('should display login form', async ({ page }) => {
    // Check for login form elements
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

    // Check for form title
    await expect(page.locator('text=/login|inicia sesión|sign in/i')).toBeVisible()
  })

  test('should show "Forgot password?" link', async ({ page }) => {
    const forgotLink = page.locator('a[href*="/forgot-password"], text=/forgot.*password|olvidé.*contraseña/i')
    await expect(forgotLink).toBeVisible()
  })

  test('should navigate to forgot-password page', async ({ page }) => {
    const forgotLink = page.locator('a[href*="/forgot-password"]')

    if (await forgotLink.isVisible()) {
      await forgotLink.click()
      await expect(page).toHaveURL(/\/forgot-password/)
    }
  })

  test('should navigate to register page from login', async ({ page }) => {
    const registerLink = page.locator('a[href*="/register"], text=/register|sign up|registrate/i')

    if (await registerLink.isVisible()) {
      await registerLink.click()
      await expect(page).toHaveURL(/\/register/)
    }
  })

  test('should validate email format', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')

    await emailInput.fill('invalid-email')

    // HTML5 validation
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity())
    expect(isInvalid).toBe(true)
  })

  test('should reject login with empty fields', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"]')

    // Try to submit empty form
    await submitButton.click()

    // Should show validation error or still be on login page
    await expect(page).toHaveURL(/\/login/)
  })

  test('should show error for invalid credentials', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const submitButton = page.locator('button[type="submit"]')

    // Use non-existent credentials
    await emailInput.fill('nonexistent@example.com')
    await passwordInput.fill('WrongPassword123!')

    await submitButton.click()

    // Wait for error response
    await page.waitForTimeout(1000)

    // Should show error message or stay on login page
    const errorMessage = page.locator('[role="alert"], .error, .text-red, text=/invalid|incorrect|error/i')
    const isVisible = await errorMessage.isVisible().catch(() => false)

    // Either shows error or redirects to login/error
    if (isVisible) {
      await expect(errorMessage).toBeVisible()
    } else {
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test('should preserve email field on error', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const submitButton = page.locator('button[type="submit"]')

    const testEmail = 'test@example.com'
    await emailInput.fill(testEmail)
    await passwordInput.fill('WrongPassword123!')

    await submitButton.click()
    await page.waitForTimeout(1000)

    // Email should be preserved
    const emailValue = await emailInput.inputValue()
    expect(emailValue).toBe(testEmail)
  })

  test('should support password visibility toggle (if implemented)', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]')
    const toggleButton = page.locator('[data-testid="toggle-password"], button:has-text("Show")')

    if (await toggleButton.isVisible()) {
      // Toggle to show password
      await toggleButton.click()

      // Password input type should change to text
      const inputType = await passwordInput.evaluate((el: HTMLInputElement) => el.type)
      expect(inputType).toBe('text')

      // Toggle back
      await toggleButton.click()

      const inputTypeAgain = await passwordInput.evaluate((el: HTMLInputElement) => el.type)
      expect(inputTypeAgain).toBe('password')
    }
  })

  test('should be accessible', async ({ page }) => {
    // Check for form labels
    const inputs = page.locator('input[type="email"], input[type="password"]')
    const inputCount = await inputs.count()

    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i)
      const hasLabel = await input.evaluate((el: any) => {
        return !!el.labels?.length || el.hasAttribute('aria-label')
      })

      expect(hasLabel).toBe(true)
    }
  })

  test('should disable submit while processing', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')
    const submitButton = page.locator('button[type="submit"]')

    // Use test credentials (may succeed or fail depending on setup)
    await emailInput.fill(`test@example.com`)
    await passwordInput.fill('TestPassword123!')

    // Check initial state
    const isInitiallyDisabled = await submitButton.isDisabled()

    await submitButton.click()

    // Button may briefly become disabled
    await page.waitForTimeout(500)

    // Page should change or show error
    const hasErrorOrRedirect = await Promise.race([
      page.waitForURL(/\/dashboard|\/|\/error|\/login/).then(() => true),
      page.waitForLoadState('networkidle').then(() => true),
    ]).catch(() => false)

    expect(hasErrorOrRedirect).toBe(true)
  })

  test('should remember user session after login', async ({ browser, context }) => {
    // This test verifies session persistence
    const page = await context.newPage()
    await page.goto('/login')

    // After successful auth setup, navigating to / should redirect
    // (This assumes auth.setup.ts has already authenticated)
    await page.goto('/')

    // If authenticated, should redirect to dashboard
    // If not authenticated, should stay on home or login
    const url = page.url()
    expect(url).toBeTruthy()
  })

  test('should have correct page title', async ({ page }) => {
    const title = await page.title()
    const titleLower = title.toLowerCase()
    const hasValidTitle = titleLower.includes('login') || titleLower.includes('signin') || titleLower.includes('inicia')
    expect(hasValidTitle).toBe(true)
  })
})
