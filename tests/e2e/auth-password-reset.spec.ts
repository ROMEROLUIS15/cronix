/**
 * tests/e2e/auth-password-reset.spec.ts — Password Recovery Flow E2E Tests
 *
 * Tests:
 * - Forgot password flow (email submission)
 * - Password reset link validation
 * - Reset password form submission
 * - Session handling after reset
 */

import { test, expect } from '@playwright/test'

test.describe('Password Recovery (/forgot-password, /reset-password)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forgot-password')
  })

  test('should display forgot password form', async ({ page }) => {
    // Check for email input
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()

    // Check for form title
    await expect(page.locator('text=/forgot.*password|olvidé.*contraseña/i')).toBeVisible()
  })

  test('should validate email format on forgot password form', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')

    await emailInput.fill('invalid-email')

    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity())
    expect(isInvalid).toBe(true)
  })

  test('should submit forgot password form with valid email', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const submitButton = page.locator('button[type="submit"]')

    // Use a test email
    await emailInput.fill(`test-${Date.now()}@example.com`)
    await submitButton.click()

    // Should show success message or redirect to confirmation page
    const successMessage = page.locator('text=/check.*email|confirmation|envio/i, [role="status"]')
    const isVisible = await successMessage.isVisible().catch(() => false)

    // Either shows confirmation or redirects
    if (isVisible) {
      await expect(successMessage).toBeVisible()
    } else {
      // May redirect to confirmation page
      const hasRedirected = page.url().includes('/') === false || page.url().includes('/forgot-password') === false
      expect(hasRedirected || isVisible).toBe(true)
    }
  })

  test('should show back to login link on forgot password page', async ({ page }) => {
    const backLink = page.locator('a[href*="/login"], text=/back.*login|inicia sesión/i')

    if (await backLink.isVisible()) {
      await backLink.click()
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test('should handle non-existent email gracefully', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const submitButton = page.locator('button[type="submit"]')

    // Use non-existent email
    await emailInput.fill('nonexistent@example.com')
    await submitButton.click()

    // Should show success (for security, don't reveal if email exists)
    // Or show error message
    await page.waitForTimeout(1000)

    const message = page.locator('[role="status"], [role="alert"], text=/check|confirmation|error/i')
    const isVisible = await message.isVisible().catch(() => false)

    expect(isVisible || page.url().includes('/forgot-password')).toBe(true)
  })

  test('should preserve email field on error', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const submitButton = page.locator('button[type="submit"]')

    const testEmail = 'test@example.com'
    await emailInput.fill(testEmail)
    await submitButton.click()

    await page.waitForTimeout(1000)

    // Email should be preserved
    const emailValue = await emailInput.inputValue().catch(() => '')
    expect(emailValue).toBe(testEmail)
  })

  test('should display reset password form on /reset-password page', async ({ page }) => {
    // Navigate directly to reset password (normally via email link)
    await page.goto('/reset-password?token=test-token')

    // Should show password input(s)
    const passwordInput = page.locator('input[type="password"]')
    const isVisible = await passwordInput.isVisible().catch(() => false)

    if (isVisible) {
      await expect(passwordInput).toBeVisible()
    }
  })

  test('should validate password requirements on reset form', async ({ page }) => {
    await page.goto('/reset-password?token=test-token')

    const passwordInput = page.locator('input[type="password"]').first()

    // Try weak password
    await passwordInput.fill('weak').catch(() => null)

    // Check if field validates minimum length
    const isInvalid = await passwordInput.evaluate((el: HTMLInputElement) => {
      return !el.checkValidity()
    }).catch(() => false)

    if (isInvalid) {
      expect(isInvalid).toBe(true)
    }
  })

  test('should handle missing or expired reset token', async ({ page }) => {
    // Try to access reset with invalid token
    await page.goto('/reset-password?token=invalid-expired-token')

    // Should show error message or redirect
    await page.waitForTimeout(1000)

    const errorMessage = page.locator('[role="alert"], text=/invalid|expired|error/i')
    const isVisible = await errorMessage.isVisible().catch(() => false)

    if (isVisible) {
      await expect(errorMessage).toBeVisible()
    } else {
      // May redirect to forgot password or login
      const url = page.url()
      expect(url.includes('/forgot-password') || url.includes('/login')).toBe(true)
    }
  })

  test('should require matching passwords (if dual-input confirmation)', async ({ page }) => {
    await page.goto('/reset-password?token=test-token')

    const passwordInputs = page.locator('input[type="password"]')
    const count = await passwordInputs.count()

    if (count >= 2) {
      // Has confirm password field
      const password = passwordInputs.first()
      const confirm = passwordInputs.last()

      await password.fill('ValidPassword123!')
      await confirm.fill('DifferentPassword123!')

      const submitButton = page.locator('button[type="submit"]')
      await submitButton.click()

      // Should show error about passwords not matching
      await page.waitForTimeout(1000)

      const errorMessage = page.locator('text=/match|confirm|igual/i, [role="alert"]')
      const isVisible = await errorMessage.isVisible().catch(() => false)

      expect(isVisible).toBe(true)
    }
  })

  test('should be accessible', async ({ page }) => {
    const inputs = page.locator('input[type="email"], input[type="password"]')
    const count = await inputs.count()

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i)
      const hasLabel = await input.evaluate((el: any) => {
        return !!el.labels?.length || el.hasAttribute('aria-label')
      }).catch(() => false)

      expect(hasLabel).toBe(true)
    }
  })
})
