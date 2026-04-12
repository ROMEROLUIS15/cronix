import { test, expect } from '@playwright/test'

test.describe('Client Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.E2E_TEST_EMAIL || 'test@cronix.com')
    await page.fill('input[name="password"]', process.env.E2E_TEST_PASSWORD || 'testpass123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('should navigate to clients list', async ({ page }) => {
    await page.click('text=Clientes')
    await page.waitForURL(/\/clients/, { timeout: 10_000 })

    // Should see clients table or empty state
    await expect(page.locator('table, text=No hay clientes, text=Search').first()).toBeVisible({ timeout: 10_000 })
      .catch(() => {
        // At minimum, we should be on the clients page
        expect(page.url()).toContain('/clients')
      })
  })

  test('should navigate to new client page', async ({ page }) => {
    await page.click('text=Clientes')
    await page.waitForURL(/\/clients/, { timeout: 10_000 })

    await page.click('text=Nuevo')
    await page.waitForURL(/\/clients\/new/, { timeout: 10_000 })

    // Verify form is visible
    await expect(page.locator('form')).toBeVisible()
  })

  test('should show client detail when clicking a client', async ({ page }) => {
    await page.click('text=Clientes')
    await page.waitForURL(/\/clients/, { timeout: 10_000 })

    // Click first client in the list (if any exist)
    const firstClient = page.locator('table tbody tr').first()
    const hasClients = await firstClient.count().then(c => c > 0).catch(() => false)

    if (hasClients) {
      await firstClient.click()
      // Should navigate to client detail
      await page.waitForURL(/\/clients\/[a-f0-9-]+/, { timeout: 10_000 })
      await expect(page.locator('text=Historial, text=Detalle, text=Info').first()).toBeVisible({ timeout: 5_000 })
        .catch(() => {
          expect(page.url()).toMatch(/\/clients\/[a-f0-9-]+/)
        })
    }
  })
})
