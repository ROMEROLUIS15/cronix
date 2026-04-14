import { test, expect } from '@playwright/test'

test.describe('Client Management', () => {
  // Auth state is already loaded via playwright.config.ts (storageState)
  // No need to login manually - auth.setup.ts handles this

  test('should navigate to clients list', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    // Navigate to clients
    const clientsLink = page.locator('a[href*="clients"]').first()
    await clientsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await clientsLink.click()
    
    await page.waitForURL(/\/clients/, { timeout: 10_000 })
    expect(page.url()).toContain('/clients')
  })

  test('should navigate to new client page', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    // Navigate to clients first
    const clientsLink = page.locator('a[href*="clients"]').first()
    await clientsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await clientsLink.click()
    await page.waitForURL(/\/clients/, { timeout: 10_000 })
    
    // Click new client button
    const newClientButton = page.locator('a[href*="clients/new"]').first()
    await newClientButton.waitFor({ state: 'visible', timeout: 10_000 })
    await newClientButton.click()
    
    await page.waitForURL(/\/clients\/new/, { timeout: 10_000 })
    // Use .first() to avoid strict mode violation with multiple forms
    await expect(page.locator('form').first()).toBeVisible({ timeout: 5_000 })
  })

  test('should show client detail when clicking a client', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
    
    // Navigate to clients
    const clientsLink = page.locator('a[href*="clients"]').first()
    await clientsLink.waitFor({ state: 'visible', timeout: 10_000 })
    await clientsLink.click()
    await page.waitForURL(/\/clients/, { timeout: 10_000 })
    
    // Click first client in the list (if any exist)
    const firstClient = page.locator('table tbody tr, [data-testid="client-card"]').first()
    const hasClients = await firstClient.count().then(c => c > 0).catch(() => false)

    if (hasClients) {
      await firstClient.click()
      // Should navigate to client detail
      await page.waitForURL(/\/clients\/[a-f0-9-]+/, { timeout: 10_000 })
      expect(page.url()).toMatch(/\/clients\/[a-f0-9-]+/)
    }
  })
})
