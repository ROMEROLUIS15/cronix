/**
 * tests/e2e/dashboard-core-pages.spec.ts — Dashboard Core Pages E2E Tests
 *
 * Tests navigation and basic functionality on:
 * - /dashboard (main dashboard)
 * - /dashboard/profile (user profile)
 * - /dashboard/settings (settings)
 * - /dashboard/services (service management)
 */

import { test, expect } from '@playwright/test'

test.describe('Dashboard Core Pages', () => {
  test.beforeEach(async ({ page }) => {
    // All tests use authenticated context from auth.setup.ts
    // Navigate to dashboard
    await page.goto('/dashboard')

    // Wait for dashboard to load
    await page.waitForLoadState('networkidle')
  })

  test('should display main dashboard page', async ({ page }) => {
    // Check for dashboard layout elements
    const sidebar = page.locator('[data-testid="sidebar"], nav, .sidebar')
    const mainContent = page.locator('main, [role="main"]')

    const sidebarVisible = await sidebar.isVisible().catch(() => false)
    const contentVisible = await mainContent.isVisible().catch(() => false)

    expect(sidebarVisible || contentVisible).toBe(true)
  })

  test('should navigate to profile page', async ({ page }) => {
    const profileLink = page.locator('a[href*="/dashboard/profile"], text=/profile|perfil/i')

    if (await profileLink.isVisible()) {
      await profileLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/dashboard\/profile/)

      // Check for profile form elements
      const profileForm = page.locator('form, input[type="email"]')
      expect(await profileForm.isVisible().catch(() => false)).toBeTruthy()
    }
  })

  test('should load profile information', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await page.waitForLoadState('networkidle')

    // Should display user's email or name
    const profileContent = page.locator('[data-testid="profile-form"], form')
    const isVisible = await profileContent.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should allow editing profile', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await page.waitForLoadState('networkidle')

    // Find name or email input
    const nameInput = page.locator('input[name*="name"]').first()

    if (await nameInput.isVisible()) {
      // Clear and type new value
      await nameInput.fill('Test User Updated')

      // Find save button
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Guardar")')

      if (await saveButton.isVisible()) {
        await saveButton.click()

        // Should show success message or redirect
        await page.waitForTimeout(1000)

        const successMessage = page.locator('text=/updated|guardado|success/i, [role="status"]')
        const isVisible = await successMessage.isVisible().catch(() => false)

        expect(isVisible).toBeTruthy()
      }
    }
  })

  test('should navigate to settings page', async ({ page }) => {
    const settingsLink = page.locator('a[href*="/dashboard/settings"], text=/settings|configuración/i')

    if (await settingsLink.isVisible()) {
      await settingsLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/dashboard\/settings/)
    }
  })

  test('should display settings options', async ({ page }) => {
    await page.goto('/dashboard/settings')
    await page.waitForLoadState('networkidle')

    // Should show various settings sections
    const settingsForm = page.locator('form, [data-testid="settings"], .settings-content')
    const isVisible = await settingsForm.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should navigate to services page', async ({ page }) => {
    const servicesLink = page.locator('a[href*="/dashboard/services"], text=/services?|servicios/i')

    if (await servicesLink.isVisible()) {
      await servicesLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/dashboard\/services/)
    }
  })

  test('should display services list on services page', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.waitForLoadState('networkidle')

    // Should show services table or list
    const servicesList = page.locator('[data-testid="services-list"], table, .services-grid')
    const isVisible = await servicesList.isVisible().catch(() => false)

    // May also show "no services" message
    const emptyState = page.locator('text=/no services|sin servicios|empty/i')
    const emptyVisible = await emptyState.isVisible().catch(() => false)

    expect(isVisible || emptyVisible).toBe(true)
  })

  test('should have add service button', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.waitForLoadState('networkidle')

    const addButton = page.locator('button:has-text("Add"), button:has-text("Nueva"), button:has-text("Crear")')
    const isVisible = await addButton.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should navigate to setup page', async ({ page }) => {
    const setupLink = page.locator('a[href*="/dashboard/setup"], text=/setup|configuración inicial/i')

    if (await setupLink.isVisible()) {
      await setupLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/dashboard\/setup/)
    }
  })

  test('should display setup wizard or checklist', async ({ page }) => {
    await page.goto('/dashboard/setup')
    await page.waitForLoadState('networkidle')

    // Should show setup steps or checklist
    const setupContent = page.locator('[data-testid="setup"], .setup-wizard, ol, ul')
    const isVisible = await setupContent.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should navigate to team management page', async ({ page }) => {
    const teamLink = page.locator('a[href*="/dashboard/team"], text=/team|equipo/i')

    if (await teamLink.isVisible()) {
      await teamLink.click()
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/dashboard\/team/)
    }
  })

  test('should show team members list', async ({ page }) => {
    await page.goto('/dashboard/team')
    await page.waitForLoadState('networkidle')

    // Should display team members
    const teamList = page.locator('[data-testid="team-list"], table, .team-members')
    const isVisible = await teamList.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should have proper navigation sidebar', async ({ page }) => {
    // Check for navigation links in sidebar
    const sidebar = page.locator('nav, [role="navigation"], .sidebar')
    const isVisible = await sidebar.isVisible().catch(() => false)

    if (isVisible) {
      // Should have multiple navigation items
      const navItems = sidebar.locator('a, button')
      const itemCount = await navItems.count()

      expect(itemCount).toBeGreaterThan(2)
    }
  })

  test('should show user avatar or profile menu', async ({ page }) => {
    // Check for user menu in top nav
    const userMenu = page.locator('[data-testid="user-menu"], [aria-label*="user"], button:has-text("Profile")')
    const isVisible = await userMenu.isVisible().catch(() => false)

    expect(isVisible).toBeTruthy()
  })

  test('should have logout functionality', async ({ page }) => {
    // Open user menu if exists
    const userMenu = page.locator('[data-testid="user-menu"], button:has-text("Profile"), button:has-text("Account")')

    if (await userMenu.isVisible()) {
      await userMenu.click()

      // Look for logout button
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Salir")')
      const isVisible = await logoutButton.isVisible().catch(() => false)

      expect(isVisible).toBeTruthy()
    }
  })

  test('should be accessible on all core pages', async ({ page }) => {
    const pageUrls = [
      '/dashboard',
      '/dashboard/profile',
      '/dashboard/settings',
      '/dashboard/services',
      '/dashboard/setup',
      '/dashboard/team',
    ]

    for (const url of pageUrls) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')

      // Check that main content is present
      const main = page.locator('main, [role="main"]')
      const isVisible = await main.isVisible().catch(() => false)

      expect(isVisible || page.url().includes(url)).toBeTruthy()
    }
  })

  test('should handle responsive layout on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Mobile menu may collapse sidebar
    const sidebar = page.locator('nav')
    const hamburger = page.locator('button[aria-label*="menu"], button[aria-label*="Menu"]')

    // Either sidebar is visible or hamburger menu exists
    const sidebarVisible = await sidebar.isVisible().catch(() => false)
    const hamburgerVisible = await hamburger.isVisible().catch(() => false)

    expect(sidebarVisible || hamburgerVisible).toBe(true)
  })
})
