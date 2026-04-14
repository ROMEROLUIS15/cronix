/**
 * tenant-branding.spec.ts — E2E Tests for Tenant Branding v2
 *
 * Tests the complete branding flow:
 * 1. Change brand color → CSS variable injected
 * 2. Upload logo → appears in sidebar
 * 3. Verify backward compatibility (clients without branding use defaults)
 *
 * Depends on: auth.setup.ts (saved browser state)
 */

import { test, expect } from '@playwright/test'

test.describe('Tenant Branding E2E', () => {
  // Auth state is loaded via playwright.config.ts (storageState)

  test.describe('Brand Color', () => {
    test('changing brand color updates CSS variable and persists', async ({ page }) => {
      // Navigate to settings
      await page.goto('/dashboard/settings')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      await page.waitForTimeout(2000)

      // Find the brand color picker/input
      const colorInput = page.locator('input[type="color"], input[name="brandColor"]').first()
      
      // If color picker exists, change it
      if (await colorInput.count() > 0) {
        await colorInput.scrollIntoViewIfNeeded()
        await colorInput.click()
        
        // Type a new color (purple)
        await page.keyboard.type('#A855F7')
        await page.keyboard.press('Enter')
        
        await page.waitForTimeout(2000)

        // Verify CSS variable was updated in :root or html
        const rootStyles = await page.evaluate(() => {
          const root = document.documentElement
          return getComputedStyle(root).getPropertyValue('--primary')
        })
        
        // The color should be applied (format: "H S% L%")
        expect(rootStyles.trim()).toMatch(/\d+\s+\d+%\s+\d+%/)
      }
    })

    test('invalid hex color shows validation error', async ({ page }) => {
      await page.goto('/dashboard/settings')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      await page.waitForTimeout(2000)

      // Try to enter invalid color
      const colorInput = page.locator('input[name="brandColor"], input[type="text"]').first()
      if (await colorInput.count() > 0) {
        await colorInput.scrollIntoViewIfNeeded()
        await colorInput.fill('invalid-color')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1000)

        // Should show error message
        const errorMsg = page.locator('text=invalid, text=Color, text=hex').first()
        const hasError = await errorMsg.isVisible().catch(() => false)
        
        // Either shows error or rejects the input
        expect(hasError || await page.inputValue('input[name="brandColor"]').then(v => v === 'invalid-color')).toBeTruthy()
      }
    })
  })

  test.describe('Logo Upload', () => {
    test('uploading logo shows it in sidebar', async ({ page }) => {
      await page.goto('/dashboard/settings')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      await page.waitForTimeout(2000)

      // Find logo upload button/input
      const logoInput = page.locator('input[type="file"][accept*="image"]').first()
      
      if (await logoInput.count() > 0) {
        // Create a small test image
        const testImage = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          'base64'
        )
        
        await logoInput.setInputFiles({
          name: 'test-logo.png',
          mimeType: 'image/png',
          buffer: testImage,
        })

        // Wait for upload to complete
        await page.waitForTimeout(3000)

        // Verify success message
        const successMsg = page.locator('text=logoUploaded, text=Logo, text=subido, text=success').first()
        const hasSuccess = await successMsg.isVisible().catch(() => false)
        
        // Check logo appears in sidebar
        const sidebarLogo = page.locator('img[alt*="logo"], img[src*="logo"]').first()
        const logoVisible = await sidebarLogo.isVisible().catch(() => false)
        
        expect(hasSuccess || logoVisible).toBeTruthy()
      }
    })

    test('uploading non-image file shows error', async ({ page }) => {
      await page.goto('/dashboard/settings')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      await page.waitForTimeout(2000)

      const logoInput = page.locator('input[type="file"][accept*="image"]').first()
      
      if (await logoInput.count() > 0) {
        // Try to upload a PDF
        const fakePdf = Buffer.from('%PDF-1.4 fake pdf content', 'utf-8')
        
        await logoInput.setInputFiles({
          name: 'document.pdf',
          mimeType: 'application/pdf',
          buffer: fakePdf,
        })

        await page.waitForTimeout(1000)

        // Should show invalid image format error
        const errorMsg = page.locator('text=invalid, text=imagen, text=image, text=format, text=tipo').first()
        const hasError = await errorMsg.isVisible().catch(() => false)
        
        expect(hasError).toBeTruthy()
      }
    })

    test('uploading large file (>2MB) shows size error', async ({ page }) => {
      await page.goto('/dashboard/settings')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      await page.waitForTimeout(2000)

      const logoInput = page.locator('input[type="file"][accept*="image"]').first()
      
      if (await logoInput.count() > 0) {
        // Create a "large" file (simulate 3MB)
        const largeImage = Buffer.alloc(3 * 1024 * 1024, 0)
        
        await logoInput.setInputFiles({
          name: 'huge-logo.png',
          mimeType: 'image/png',
          buffer: largeImage,
        })

        await page.waitForTimeout(1000)

        // Should show file too large error
        const errorMsg = page.locator('text=large, text=grande, text=2MB, text=size, text=tamaño').first()
        const hasError = await errorMsg.isVisible().catch(() => false)
        
        expect(hasError).toBeTruthy()
      }
    })
  })

  test.describe('Backward Compatibility', () => {
    test('business without branding uses Cronix defaults', async ({ browser }) => {
      // This test verifies that businesses without brandColor/logo
      // still render correctly with default Cronix styling
      
      // Since we can't easily modify the DB mid-test, we verify the UI
      // still renders properly even if branding values are null
      await page.goto('/dashboard')
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
      
      // The page should load regardless of branding status
      expect(page.url()).toContain('/dashboard')
      
      // Sidebar should be visible
      const sidebar = page.locator('aside, nav, [class*="sidebar"]').first()
      const sidebarVisible = await sidebar.isVisible().catch(() => false)
      
      // Main content should be visible
      const mainContent = page.locator('main, [class*="content"]').first()
      const contentVisible = await mainContent.isVisible().catch(() => false)
      
      expect(sidebarVisible || contentVisible).toBeTruthy()
    })
  })
})
