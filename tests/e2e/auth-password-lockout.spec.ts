import { test, expect } from '@playwright/test'

test.describe('Password Lockout — 3 Failed Attempts', () => {
  const testEmail = `lockout-test-${Date.now()}@example.com`
  const wrongPassword = 'WrongPassword123!'
  const correctPassword = 'TestPassword123!'

  test.beforeAll(async () => {
    // Create test user in database before tests run
    // This would be done via API call or database seeding
  })

  test('should show "invalid credentials" after 1st failed attempt', async ({ page }) => {
    await page.goto('http://localhost:3000/auth/login')

    // Enter credentials
    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', wrongPassword)

    // Submit form
    await page.click('button[type="submit"]')

    // Verify error message
    await expect(
      page.locator('text=Contraseña o correo inválido')
    ).toBeVisible()

    // Should NOT show lockout message yet
    await expect(
      page.locator('text=bloqueado|Bloqueado')
    ).not.toBeVisible()
  })

  test('should show "invalid credentials" after 2nd failed attempt', async ({ page }) => {
    await page.goto('http://localhost:3000/auth/login')

    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Verify error message
    await expect(
      page.locator('text=Contraseña o correo inválido')
    ).toBeVisible()

    // Should show attempt counter (2/3)
    await expect(
      page.locator('text=/Intento 2 de 3|attempt 2/')
    ).toBeVisible()

    // Should NOT show lockout yet
    await expect(
      page.locator('text=bloqueado|Bloqueado')
    ).not.toBeVisible()
  })

  test('should LOCK user after 3rd failed attempt', async ({ page }) => {
    await page.goto('http://localhost:3000/auth/login')

    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Verify lockout message
    await expect(
      page.locator('text=/bloqueado|locked|intenta en 15 minutos/')
    ).toBeVisible()

    // Should show redirect button
    await expect(
      page.locator('button:has-text("Restablecer contraseña")')
    ).toBeVisible()

    // Should NOT show login form anymore
    await expect(
      page.locator('input[type="password"]')
    ).not.toBeVisible()
  })

  test('should show "Account Locked" message with retry timer', async ({ page }) => {
    await page.goto('http://localhost:3000/auth/login')

    // Try to login while locked
    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Verify locked UI
    const lockedMessage = page.locator('text=/bloqueado|locked/')
    await expect(lockedMessage).toBeVisible()

    // Should show timer "Bloqueado por 15 minutos" o similar
    await expect(
      page.locator('text=/15 minutos|15 minutes/')
    ).toBeVisible()

    // Should show "Reset Password" button
    await expect(
      page.locator('button:has-text("Restablecer contraseña")')
    ).toBeVisible()
  })

  test('should redirect to password reset page', async ({ page }) => {
    await page.goto('http://localhost:3000/auth/login')

    // Fill form
    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Click "Reset Password" button
    await page.click('button:has-text("Restablecer contraseña")')

    // Should be on reset password page
    await expect(page).toHaveURL(/\/auth\/.*reset|forgot.*password/i)

    // Should pre-fill email
    await expect(
      page.locator(`input[type="email"][value="${testEmail}"]`)
    ).toBeVisible()
  })

  test('should allow login after password reset', async ({ page }) => {
    // First, reset the password via email link simulation
    // (In real scenario, user would receive email with reset link)

    // Navigate to password reset with token
    await page.goto('http://localhost:3000/auth/reset-password')

    // Enter new password
    const newPassword = `NewPassword${Date.now()}!`
    await page.fill('input[placeholder="Nueva contraseña"]', newPassword)
    await page.fill('input[placeholder="Confirmar contraseña"]', newPassword)

    // Submit reset
    await page.click('button:has-text("Cambiar contraseña")')

    // Should show success message
    await expect(
      page.locator('text=/contraseña.*restablecida|password.*reset/')
    ).toBeVisible()

    // Navigate to login
    await page.goto('http://localhost:3000/auth/login')

    // Login with new password should work
    await page.fill('input[type="email"]', testEmail)
    await page.fill('input[type="password"]', newPassword)
    await page.click('button[type="submit"]')

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard|\/home/)

    // Should see dashboard content
    await expect(
      page.locator('text=Dashboard')
    ).toBeVisible()
  })

  test('should display attempt counter (1/3, 2/3)', async ({ page }) => {
    const testEmail2 = `lockout-test-2-${Date.now()}@example.com`

    await page.goto('http://localhost:3000/auth/login')

    // First attempt
    await page.fill('input[type="email"]', testEmail2)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Should show 1/3
    await expect(
      page.locator('text=/1 de 3|1 of 3|1\/3/')
    ).toBeVisible()

    // Second attempt (reload and try again)
    await page.goto('http://localhost:3000/auth/login')
    await page.fill('input[type="email"]', testEmail2)
    await page.fill('input[type="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    // Should show 2/3
    await expect(
      page.locator('text=/2 de 3|2 of 3|2\/3/')
    ).toBeVisible()
  })

  test('should show warning message after 2 failed attempts', async ({ page }) => {
    const testEmail3 = `lockout-test-3-${Date.now()}@example.com`

    await page.goto('http://localhost:3000/auth/login')

    // Fail twice
    for (let i = 0; i < 2; i++) {
      await page.fill('input[type="email"]', testEmail3)
      await page.fill('input[type="password"]', wrongPassword)
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)
    }

    // After 2 attempts, should show warning
    await expect(
      page.locator('text=/un intento|one attempt|one more/')
    ).toBeVisible()
  })
})
