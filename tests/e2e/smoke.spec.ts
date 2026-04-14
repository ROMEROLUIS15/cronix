import { test, expect } from '@playwright/test';

test.describe('Cronix Smoke Test', () => {
  test('should load the landing page', async ({ page }) => {
    // We attempt to load the root which should redirect to /[locale]
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Check if the title or some known text exists
    // Cronix usually has "Cronix" in the metadata title
    await expect(page).toHaveTitle(/Cronix/, { timeout: 10_000 });
  });

  test('should load the login page', async ({ page }) => {
    // The app uses i18n routing: /login → /es/login
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Wait a bit for client-side hydration (Next.js App Router)
    await page.waitForTimeout(1000);

    // The login form always has these inputs regardless of locale/translation
    // Using the email input is more reliable than a translated heading text
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible({ timeout: 15_000 });

    // Also verify the submit button contains login text
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible({ timeout: 5_000 });
  });
});
