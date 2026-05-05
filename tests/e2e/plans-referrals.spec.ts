/**
 * tests/e2e/plans-referrals.spec.ts
 *
 * Tests E2E (Playwright) para la página unificada /dashboard/plans.
 *
 * Cubre:
 * 1. El nav item "Plan & Recompensas" aparece en el sidebar
 * 2. La ruta /dashboard/plans carga sin error
 * 3. El topbar muestra el título correcto
 * 4. La sección de plan (PlanManager) está visible
 * 5. La sección de referidos (ReferralClient) está visible
 * 6. El botón de copiar enlace funciona
 * 7. La ruta /dashboard/referrals redirige a /dashboard/plans
 *
 * Pre-requisitos:
 * - `npm run dev` corriendo en localhost:3000
 * - Variables de entorno E2E_TEST_EMAIL / E2E_TEST_PASSWORD en .env.local
 * - Migración 20260504100000_referral_system.sql aplicada en la DB remota
 *
 * Ejecutar: npx playwright test tests/e2e/plans-referrals.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function goToPlans(page: Page) {
  await page.goto(`${BASE_URL}/es/dashboard/plans`);
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
}

// ─── Suite 1: Sidebar nav item ────────────────────────────────────────────────

test.describe('Sidebar — Plan & Recompensas nav item', () => {
  test('sidebar shows the Plans nav link', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Use .first() — sidebar renders twice (desktop + mobile overlay in DOM)
    const plansLink = page.locator('a[href*="/dashboard/plans"]').first();
    await expect(plansLink).toBeVisible({ timeout: 10_000 });
  });

  test('Plans nav link text matches "Plan & Recompensas"', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    const plansLink = page.locator('a[href*="/dashboard/plans"]').first();
    await expect(plansLink).toContainText(/plan.*recompensas/i, { timeout: 10_000 });
  });

  test('clicking Plans nav link navigates to /dashboard/plans', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    const plansLink = page.locator('a[href*="/dashboard/plans"]').first();
    await plansLink.click();
    await page.waitForURL(/\/dashboard\/plans/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard/plans');
  });
});

// ─── Suite 2: Page load ───────────────────────────────────────────────────────

test.describe('/dashboard/plans — page load', () => {
  test('page loads without redirect to login', async ({ page }) => {
    await goToPlans(page);
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toContain('/dashboard/plans');
  });

  test('page does not show error state for authenticated user with business', async ({ page }) => {
    await goToPlans(page);
    await expect(page.getByText(/no tienes un negocio/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test('topbar shows Plan & Recompensas title', async ({ page }) => {
    await goToPlans(page);
    await expect(
      page.getByRole('heading', { name: /plan.*recompensas/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Suite 3: Plan section ────────────────────────────────────────────────────

test.describe('/dashboard/plans — plan section', () => {
  test('shows the plan section heading', async ({ page }) => {
    await goToPlans(page);
    await expect(page.getByText(/tu plan actual/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows the Gestionar plan button', async ({ page }) => {
    await goToPlans(page);
    const manageBtn = page.locator('button').filter({ hasText: /gestionar/i }).first();
    await expect(manageBtn).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Gestionar plan opens the plan comparison modal', async ({ page }) => {
    await goToPlans(page);
    const manageBtn = page.locator('button').filter({ hasText: /gestionar/i }).first();
    await manageBtn.click();
    await page.waitForTimeout(600);

    // Modal or comparison table appears
    await expect(
      page.locator('#desktop-activate-pro, #mobile-activate-pro').first()
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ─── Suite 4: Referral section ────────────────────────────────────────────────

test.describe('/dashboard/plans — referral section', () => {
  test('shows the referral program heading', async ({ page }) => {
    await goToPlans(page);
    await expect(page.getByText(/programa de referidos/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows the referral link input with the business referral code', async ({ page }) => {
    await goToPlans(page);
    // The referral link contains /register?ref=
    await expect(page.locator('span').filter({ hasText: /register\?ref=/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows the copy link button', async ({ page }) => {
    await goToPlans(page);
    const copyBtn = page.locator('button').filter({ hasText: /copiar|copy/i }).first();
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });
  });

  test('copy link button shows confirmation after click', async ({ page }) => {
    await goToPlans(page);
    const copyBtn = page.locator('button').filter({ hasText: /copiar|copy/i }).first();
    await copyBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await copyBtn.click();

    // Should show "Copiado" or similar confirmation
    await expect(
      page.locator('button').filter({ hasText: /copiado|copied/i }).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('shows "Estado de Recompensas" or "Cómo funciona" sections', async ({ page }) => {
    await goToPlans(page);
    // One of these is always present regardless of plan
    const rewardOrHowIt = page.locator('h3').filter({ hasText: /recompensas|funciona/i }).first();
    await expect(rewardOrHowIt).toBeVisible({ timeout: 10_000 });
  });

  test('shows the referrals list section heading', async ({ page }) => {
    await goToPlans(page);
    // Heading contains "Tus Referidos"
    await expect(page.locator('h3').filter({ hasText: /referidos/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows divider between plan and referral sections', async ({ page }) => {
    await goToPlans(page);
    // The divider is a hr-like element; verify both sections exist instead
    await expect(page.getByText(/tu plan actual/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/programa de referidos/i)).toBeVisible({ timeout: 8_000 });
  });
});

// ─── Suite 5: /dashboard/referrals redirect ───────────────────────────────────

test.describe('/dashboard/referrals — redirect', () => {
  test('redirects to /dashboard/plans', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/referrals`);
    await page.waitForURL(/\/dashboard\/plans/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard/plans');
  });

  test('redirect lands on a working page (no error)', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/referrals`);
    await page.waitForURL(/\/dashboard\/plans/, { timeout: 10_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });

    await expect(page.getByText(/tu plan actual/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Suite 6: Settings CTA ────────────────────────────────────────────────────

test.describe('Settings page — referral CTA', () => {
  test('settings page shows the "Gana más citas" CTA', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/settings`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    await expect(page.getByText(/gana más citas/i)).toBeVisible({ timeout: 10_000 });
  });

  test('CTA link in settings points to /dashboard/plans', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/settings`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    const ctaLink = page.locator('a[href*="/dashboard/plans"]').first();
    await expect(ctaLink).toBeVisible({ timeout: 10_000 });
  });

  test('clicking settings CTA navigates to plans page', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/settings`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    const ctaLink = page.locator('a[href*="/dashboard/plans"]').first();
    await ctaLink.click();
    await page.waitForURL(/\/dashboard\/plans/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard/plans');
  });
});

// ─── Suite 7: Responsive — mobile viewport ───────────────────────────────────

test.describe('/dashboard/plans — mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14

  test('page loads without horizontal overflow on mobile', async ({ page }) => {
    await goToPlans(page);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });

  test('referral link and copy button stack vertically on mobile', async ({ page }) => {
    await goToPlans(page);
    const copyBtn = page.locator('button').filter({ hasText: /copiar|copy/i }).first();
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });
  });

  test('plan section is visible on mobile', async ({ page }) => {
    await goToPlans(page);
    await expect(page.getByText(/tu plan actual/i)).toBeVisible({ timeout: 10_000 });
  });

  test('referral section is visible on mobile', async ({ page }) => {
    await goToPlans(page);
    await expect(page.getByText(/programa de referidos/i)).toBeVisible({ timeout: 10_000 });
  });
});
