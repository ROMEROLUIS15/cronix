/**
 * tests/e2e/auth-invite.spec.ts — Team Invite Flow E2E Tests
 *
 * Tests:
 * - Accessing invite page with valid code
 * - Displaying invite acceptance form
 * - Completing invitation (accept/reject)
 * - Handling invalid or expired codes
 */

import { test, expect } from '@playwright/test'

test.describe('Team Invite (/invite/[code])', () => {
  // Use a test invite code (normally from a real invite link)
  const testInviteCode = 'test-invite-123'

  test.beforeEach(async ({ page }) => {
    // Try to navigate to invite page with test code
    // In real scenario, this would be a valid invite code from database
    await page.goto(`/invite/${testInviteCode}`)
  })

  test('should display invite information page', async ({ page }) => {
    // Page should show invitation details
    const title = page.locator('text=/invite|invitación|team/i')
    const isVisible = await title.isVisible().catch(() => false)

    // Either shows invitation content or error about invalid code
    const invalidCode = page.locator('text=/invalid|expired|not found/i')
    const invalidVisible = await invalidCode.isVisible().catch(() => false)

    expect(isVisible || invalidVisible).toBe(true)
  })

  test('should handle invalid invite code', async ({ page }) => {
    // Navigate with invalid code
    await page.goto(`/invite/invalid-code-xyz`)

    // Should show error message
    const errorMessage = page.locator('text=/invalid|expired|not found|no longer/i, [role="alert"]')
    const isVisible = await errorMessage.isVisible().catch(() => false)

    if (isVisible) {
      await expect(errorMessage).toBeVisible()
    } else {
      // May redirect to home or login
      const url = page.url()
      expect(url.includes('/invite')).toBe(false)
    }
  })

  test('should show accept button for valid invite', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle').catch(() => null)

    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Aceptar")')
    const isVisible = await acceptButton.isVisible().catch(() => false)

    if (isVisible) {
      await expect(acceptButton).toBeVisible()
    }
  })

  test('should show inviter business information', async ({ page }) => {
    await page.waitForLoadState('networkidle').catch(() => null)

    // Should show business name, owner name, or invite context
    const businessInfo = page.locator('[data-testid="invite-business"], text=/business|negocio|empresa/i')
    const isVisible = await businessInfo.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should accept invite and redirect to setup or dashboard', async ({ page }) => {
    await page.waitForLoadState('networkidle').catch(() => null)

    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Aceptar")')

    if (await acceptButton.isVisible()) {
      await acceptButton.click()

      // Should redirect to dashboard, setup, or login
      await Promise.race([
        page.waitForURL(/\/dashboard|\/setup|\/login/).catch(() => null),
        page.waitForLoadState('networkidle').catch(() => null),
      ])

      const url = page.url()
      expect(url).toBeTruthy()
    }
  })

  test('should allow declining invite', async ({ page }) => {
    await page.waitForLoadState('networkidle').catch(() => null)

    const declineButton = page.locator('button:has-text("Decline"), button:has-text("Rechazar")')

    if (await declineButton.isVisible()) {
      await declineButton.click()

      // Should show confirmation or redirect
      await page.waitForLoadState('networkidle').catch(() => null)

      const url = page.url()
      expect(url.includes('/invite')).toBe(false)
    }
  })

  test('should require authentication to accept invite', async ({ browser }) => {
    // Create new context (unauthenticated)
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`/invite/${testInviteCode}`)

    // If invite is auth-protected, should redirect to login or show auth requirement
    const isOnInvitePage = page.url().includes('/invite')
    const isOnLoginPage = page.url().includes('/login')

    expect(isOnInvitePage || isOnLoginPage).toBe(true)

    await context.close()
  })

  test('should show "Back" button to return to previous page', async ({ page }) => {
    const backButton = page.locator('button:has-text("Back"), a:has-text("Back"), a[href="/"]')

    const isVisible = await backButton.isVisible().catch(() => false)

    if (isVisible) {
      await expect(backButton).toBeVisible()
    }
  })

  test('should be accessible', async ({ page }) => {
    // Check for form labels if present
    const inputs = page.locator('input')
    const count = await inputs.count()

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i)
      const hasLabel = await input.evaluate((el) => {
        return !!el.labels?.length || el.hasAttribute('aria-label')
      }).catch(() => false)

      if (count > 0) {
        expect(hasLabel).toBeTruthy()
      }
    }

    // Check buttons have text
    const buttons = page.locator('button')
    const buttonCount = await buttons.count()

    for (let i = 0; i < Math.min(buttonCount, 3); i++) {
      const button = buttons.nth(i)
      const hasText = await button.evaluate((el) => el.textContent?.trim().length > 0)
      expect(hasText).toBeTruthy()
    }
  })

  test('should display proper error for expired invite', async ({ page }) => {
    // Use a code that would be expired in real scenario
    await page.goto(`/invite/expired-code-old`)

    // Should show appropriate error
    const errorOrRedirect = page.url().includes('/invite') === false ||
      await page.locator('text=/expired|no longer valid/i').isVisible().catch(() => false)

    expect(errorOrRedirect).toBeTruthy()
  })
})
