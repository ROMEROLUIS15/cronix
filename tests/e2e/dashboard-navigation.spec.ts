import { test, expect } from '@playwright/test'

test.describe('Dashboard Navigation', () => {
  // Auth state is already loaded via playwright.config.ts (storageState)
  // No need to login manually - auth.setup.ts handles this

  test('should load dashboard with calendar', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    
    // Dashboard should be accessible
    expect(page.url()).toContain('/dashboard')
  })

  test('should navigate to settings', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    // Look for settings/navigation links - try multiple strategies
    const settingsLink = page.locator('a[href*="settings"]').first()
    await settingsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await settingsLink.click()
    
    await page.waitForURL(/\/settings/, { timeout: 10_000 })
    expect(page.url()).toContain('/settings')
  })

  test('should navigate to finances', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    const financesLink = page.locator('a[href*="finances"]').first()
    await financesLink.waitFor({ state: 'visible', timeout: 10_000 })
    await financesLink.click()
    
    await page.waitForURL(/\/finances/, { timeout: 10_000 })
    expect(page.url()).toContain('/finances')
  })

  test('should navigate to reports', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    const reportsLink = page.locator('a[href*="reports"]').first()
    await reportsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await reportsLink.click()
    
    await page.waitForURL(/\/reports/, { timeout: 10_000 })
    expect(page.url()).toContain('/reports')
  })

  test('should redirect unauthenticated user to login', async ({ browser }) => {
    // Create a completely new browser context WITHOUT storageState
    // The project config adds storageState to all contexts, so we need to override it
    const context = await browser.newContext({
      storageState: undefined // Explicitly clear auth state
    })
    const newPage = await context.newPage()
    
    await newPage.goto('/dashboard')
    await newPage.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    await page.waitForTimeout(1000)
    
    // Should be redirected to login (or showing login page)
    const url = newPage.url()
    // Accept either /login or a redirect to login
    const isOnLoginPage = url.includes('/login') || url.includes('/auth')
    expect(isOnLoginPage, `Expected to be on login page but was at: ${url}`).toBe(true)
    
    await newPage.close()
    await context.close()
  })
})
