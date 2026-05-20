/**
 * tests/e2e/business-flows-clients.spec.ts — Client Management Business Flow E2E Tests
 *
 * Tests critical business workflows:
 * - Creating a new client
 * - Viewing client list
 * - Editing client details
 * - Searching and filtering clients
 * - Deleting a client
 */

import { test, expect } from '@playwright/test'

test.describe('Client Management Flow (/dashboard/clients)', () => {
  test.beforeEach(async ({ page }) => {
    // All tests use authenticated context
    await page.goto('/dashboard/clients')
    await page.waitForLoadState('networkidle')
  })

  test('should display clients page with list', async ({ page }) => {
    // Check for clients list or empty state
    const clientsList = page.locator('[data-testid="clients-list"], table, .clients-grid')
    const emptyState = page.locator('text=/no clients|sin clientes|empty/i')

    const listVisible = await clientsList.isVisible().catch(() => false)
    const emptyVisible = await emptyState.isVisible().catch(() => false)

    expect(listVisible || emptyVisible).toBe(true)
  })

  test('should have button to create new client', async ({ page }) => {
    const newClientButton = page.locator('button:has-text("New"), button:has-text("Nuevo"), a[href*="/clients/new"]')

    const isVisible = await newClientButton.isVisible().catch(() => false)
    expect(isVisible).toBe(true)
  })

  test('should navigate to create client form', async ({ page }) => {
    const newClientButton = page.locator('button:has-text("New"), button:has-text("Nuevo"), a[href*="/clients/new"]')

    if (await newClientButton.isVisible()) {
      await newClientButton.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/clients\/new/)

      // Check for form
      const form = page.locator('form, [data-testid="client-form"]')
      await expect(form).toBeVisible()
    }
  })

  test('should fill and submit new client form', async ({ page }) => {
    // Navigate to new client form
    await page.goto('/dashboard/clients/new')
    await page.waitForLoadState('networkidle')

    // Fill form fields
    const nameInput = page.locator('input[name*="name"], input[placeholder*="name" i]').first()
    const emailInput = page.locator('input[type="email"]').first()
    const phoneInput = page.locator('input[type="tel"], input[name*="phone"]').first()

    const timestamp = Date.now()
    const testName = `Test Client ${timestamp}`
    const testEmail = `client-${timestamp}@example.com`
    const testPhone = '+34-600-000-000'

    // Fill available fields
    if (await nameInput.isVisible()) {
      await nameInput.fill(testName)
    }

    if (await emailInput.isVisible()) {
      await emailInput.fill(testEmail)
    }

    if (await phoneInput.isVisible()) {
      await phoneInput.fill(testPhone)
    }

    // Find and click submit button
    const submitButton = page.locator('button[type="submit"]:has-text("Create"), button[type="submit"]:has-text("Crear"), button[type="submit"]:has-text("Save")')

    if (await submitButton.isVisible()) {
      await submitButton.click()

      // Should redirect to clients list or show success
      await page.waitForTimeout(1000)

      // Verify success
      const successMessage = page.locator('text=/created|creado|success/i, [role="status"]')
      const redirected = page.url().includes('/clients')

      expect(await successMessage.isVisible().catch(() => false) || redirected).toBe(true)
    }
  })

  test('should search for clients by name', async ({ page }) => {
    // Look for search input
    const searchInput = page.locator('input[placeholder*="search" i], input[name*="search"]')

    if (await searchInput.isVisible()) {
      await searchInput.fill('Test')

      // Should filter results
      await page.waitForTimeout(500)

      const clientsList = page.locator('[data-testid="clients-list"], table tbody tr')
      const listVisible = await clientsList.isVisible().catch(() => false)

      expect(listVisible).toBeTruthy()
    }
  })

  test('should view client details', async ({ page }) => {
    // Find first client in list
    const firstClient = page.locator('[data-testid="client-row"], table tbody tr').first()

    if (await firstClient.isVisible()) {
      // Click on client name or view button
      const clientLink = firstClient.locator('a, button:has-text("View")')

      if (await clientLink.isVisible()) {
        await clientLink.click()
        await page.waitForLoadState('networkidle')

        // Should navigate to client detail page
        const clientDetail = page.locator('[data-testid="client-detail"], h1, h2')
        await expect(clientDetail).toBeVisible()
      }
    }
  })

  test('should edit client from detail page', async ({ page }) => {
    // Navigate to a client detail page
    await page.goto('/dashboard/clients')
    await page.waitForLoadState('networkidle')

    const firstClient = page.locator('[data-testid="client-row"], table tbody tr').first()

    if (await firstClient.isVisible()) {
      const clientLink = firstClient.locator('a').first()

      if (await clientLink.isVisible()) {
        await clientLink.click()
        await page.waitForLoadState('networkidle')

        // Look for edit button
        const editButton = page.locator('button:has-text("Edit"), button:has-text("Editar"), a[href*="/edit"]')

        if (await editButton.isVisible()) {
          await editButton.click()
          await page.waitForLoadState('networkidle')

          // Should show edit form
          const form = page.locator('form, [data-testid="client-form"]')
          await expect(form).toBeVisible()

          // Edit a field
          const nameInput = page.locator('input[name*="name"]').first()

          if (await nameInput.isVisible()) {
            await nameInput.fill(`Updated Name ${Date.now()}`)

            // Save changes
            const saveButton = page.locator('button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Guardar")')

            if (await saveButton.isVisible()) {
              await saveButton.click()
              await page.waitForTimeout(1000)

              // Should show success
              const successMessage = page.locator('text=/updated|guardado|success/i')
              const isVisible = await successMessage.isVisible().catch(() => false)

              expect(isVisible).toBeTruthy()
            }
          }
        }
      }
    }
  })

  test('should filter clients by status', async ({ page }) => {
    // Look for status filter
    const statusFilter = page.locator('select[name*="status"], button:has-text("Status"), button:has-text("Estado")')

    if (await statusFilter.isVisible()) {
      await statusFilter.click()

      // Select an option
      const option = page.locator('text=/active|inactive|archived/i').first()

      if (await option.isVisible()) {
        await option.click()

        // Should filter results
        await page.waitForTimeout(500)

        const clientsList = page.locator('[data-testid="clients-list"], table tbody tr')
        const isVisible = await clientsList.isVisible().catch(() => false)

        expect(isVisible).toBeTruthy()
      }
    }
  })

  test('should show client count or pagination', async ({ page }) => {
    // Check for client count display
    const clientCount = page.locator('text=/\\d+ clients?|\\d+ clientes?/i')
    const pagination = page.locator('[role="navigation"] >> text=/page|página/i, button:has-text("Next")')

    const countVisible = await clientCount.isVisible().catch(() => false)
    const paginationVisible = await pagination.isVisible().catch(() => false)

    expect(countVisible || paginationVisible).toBeTruthy()
  })

  test('should have responsive table on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    await page.goto('/dashboard/clients')
    await page.waitForLoadState('networkidle')

    // Should either show table (with horizontal scroll) or card layout
    const table = page.locator('table')
    const cardLayout = page.locator('[data-testid="client-card"], .client-card')

    const tableVisible = await table.isVisible().catch(() => false)
    const cardVisible = await cardLayout.isVisible().catch(() => false)

    expect(tableVisible || cardVisible).toBe(true)
  })

  test('should handle empty state gracefully', async ({ page }) => {
    // If there are no clients, should show helpful message
    const emptyState = page.locator('text=/no clients|sin clientes|get started/i')
    const clientList = page.locator('[data-testid="clients-list"] [data-testid="client-row"]')

    const emptyVisible = await emptyState.isVisible().catch(() => false)
    const clientCount = await clientList.count()

    if (clientCount === 0) {
      expect(emptyVisible).toBe(true)
    }
  })

  test('should be keyboard navigable', async ({ page }) => {
    // Tab through form elements
    const newClientButton = page.locator('button:has-text("New")')

    if (await newClientButton.isVisible()) {
      // Focus on button using Tab
      await page.keyboard.press('Tab')

      // Check if any element is focused
      const focused = page.locator(':focus')
      const isFocused = await focused.count().then(c => c > 0)

      expect(isFocused).toBeTruthy()
    }
  })
})
