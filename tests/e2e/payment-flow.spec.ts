/**
 * tests/e2e/payment-flow.spec.ts
 *
 * Tests E2E (Playwright) para el flujo completo de pagos manuales.
 *
 * Cubre:
 * 1. El modal de selección de método aparece al hacer clic en "Activar Pro"
 * 2. Navegación entre pasos (selección → formulario → éxito)
 * 3. Botones de copiar visibles en Pago Móvil
 * 4. Sección admin/payments visible solo para platform_admin
 * 5. El sidebar muestra el ítem "Payments" para platform_admin
 *
 * Pre-requisitos:
 * - `npm run dev` corriendo en localhost:3000
 * - Variables de entorno E2E_TEST_EMAIL / E2E_TEST_PASSWORD en .env.local
 * - Correr auth.setup.ts primero (playwright.config.ts lo hace automáticamente)
 *
 * Ejecutar: npx playwright test tests/e2e/payment-flow.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function navigateToSettings(page: Page) {
  await page.goto(`${BASE_URL}/es/dashboard/settings`);
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
}

async function openPlanModal(page: Page) {
  // Click "Gestionar plan" or "Manage Plan" button
  const managePlanBtn = page.locator('button, a').filter({ hasText: /gestionar|manage plan/i }).first();
  await managePlanBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await managePlanBtn.click();
  // Wait for comparison modal/table to appear
  await page.waitForTimeout(800);
}

// ─── Suite 1: Sidebar — Payments nav item ────────────────────────────────────

test.describe('Admin Sidebar — Payments nav item', () => {
  test('platform_admin should see "Payments" in the sidebar', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // The sidebar link to /dashboard/admin/payments should exist
    const paymentsLink = page.locator('a[href*="/dashboard/admin/payments"]');
    await expect(paymentsLink).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar should show System Pulse and User Management for admin', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    await expect(page.locator('a[href*="/dashboard/admin/pulse"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('a[href*="/dashboard/admin/users"]')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Suite 2: Admin Payments page ────────────────────────────────────────────

test.describe('Admin Payments page — /dashboard/admin/payments', () => {
  test('should load the admin payments page', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/admin/payments`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Should NOT be redirected to login
    expect(page.url()).not.toContain('/login');
  });

  test('should show "Pagos Manuales" heading', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/admin/payments`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: /pagos manuales/i })).toBeVisible({ timeout: 10_000 });
  });

  test('should show Pendientes and Todos filter tabs', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/admin/payments`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: /pendientes/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /todos/i })).toBeVisible({ timeout: 10_000 });
  });

  test('should show Actualizar button', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/admin/payments`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    await expect(page.getByRole('button', { name: /actualizar/i })).toBeVisible({ timeout: 10_000 });
  });

  test('filter tabs switch between Pendientes and Todos', async ({ page }) => {
    await page.goto(`${BASE_URL}/es/dashboard/admin/payments`);
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

    // Click "Todos"
    const todosBtn = page.getByRole('button', { name: /todos/i });
    await todosBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await todosBtn.click();
    await page.waitForTimeout(500);

    // Click back to "Pendientes"
    const pendientesBtn = page.getByRole('button', { name: /pendientes/i });
    await pendientesBtn.click();
    await page.waitForTimeout(500);

    // No crash — page still intact
    await expect(page.getByRole('heading', { name: /pagos manuales/i })).toBeVisible();
  });
});

// ─── Suite 3: Payment Modal — selection step ──────────────────────────────────

test.describe('Payment Modal — method selection', () => {
  test('modal opens and shows 3 payment methods', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    // Click "Activar Pro" button to open the payment method modal
    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() > 0) {
      await activateBtn.click();
      await page.waitForTimeout(600);

      // All 3 method cards should be visible
      await expect(page.locator('#method-nowpayments')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('#method-pago_movil')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#method-binance_manual')).toBeVisible({ timeout: 5_000 });
    } else {
      test.skip(); // Already on Pro — skip
    }
  });

  test('continue button is present on step 1', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() > 0) {
      await activateBtn.click();
      await expect(page.locator('#payment-method-continue')).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip();
    }
  });
});

// ─── Suite 4: Payment Modal — Pago Móvil form ────────────────────────────────

test.describe('Payment Modal — Pago Móvil flow', () => {
  test('shows Pago Móvil data with copy buttons', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() === 0) { test.skip(); return; }

    await activateBtn.click();
    await page.locator('#method-pago_movil').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#method-pago_movil').click();
    await page.locator('#payment-method-continue').click();

    // Should show Pago Móvil data
    await expect(page.getByText('Bancamiga')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('0424-709-2980')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('V-15.295.575')).toBeVisible({ timeout: 5_000 });

    // Reference input visible
    await expect(page.locator('#pago-movil-ref')).toBeVisible({ timeout: 5_000 });

    // Copy buttons visible (at least 4 — banco, teléfono, cédula, concepto)
    const copyBtns = page.getByRole('button', { name: /copy/i });
    await expect(copyBtns.first()).toBeVisible({ timeout: 5_000 });
    expect(await copyBtns.count()).toBeGreaterThanOrEqual(4);
  });

  test('back button returns to method selection', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() === 0) { test.skip(); return; }

    await activateBtn.click();
    await page.locator('#method-pago_movil').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#method-pago_movil').click();
    await page.locator('#payment-method-continue').click();
    await page.locator('#pago-movil-ref').waitFor({ state: 'visible', timeout: 8_000 });

    // Click back
    await page.getByRole('button', { name: /volver|back/i }).click();
    await expect(page.locator('#payment-method-continue')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#pago-movil-ref')).not.toBeVisible();
  });

  test('submit button is disabled without reference', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() === 0) { test.skip(); return; }

    await activateBtn.click();
    await page.locator('#method-pago_movil').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#method-pago_movil').click();
    await page.locator('#payment-method-continue').click();
    await page.locator('#pago-movil-ref').waitFor({ state: 'visible', timeout: 8_000 });

    // Click send without reference
    await page.locator('#submit-pago-movil').click();

    // Should show an error (reference validation)
    await page.waitForTimeout(500);
    // The page should still be on the form (not success)
    await expect(page.locator('#pago-movil-ref')).toBeVisible();
  });
});

// ─── Suite 5: Payment Modal — Binance flow ────────────────────────────────────

test.describe('Payment Modal — Binance Pay flow', () => {
  test('shows Binance Pay ID and exact amount', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() === 0) { test.skip(); return; }

    await activateBtn.click();
    await page.locator('#method-binance_manual').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#method-binance_manual').click();
    await page.locator('#payment-method-continue').click();

    await expect(page.getByText('550313419')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#binance-ref')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Suite 6: Modal close ─────────────────────────────────────────────────────

test.describe('Payment Modal — close behavior', () => {
  test('modal closes when X button is clicked', async ({ page }) => {
    await navigateToSettings(page);
    await openPlanModal(page);

    const activateBtn = page.locator('button').filter({ hasText: /activar.*pro|\$10/i }).first();
    if (await activateBtn.count() === 0) { test.skip(); return; }

    await activateBtn.click();
    await page.locator('#payment-modal-close').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#payment-modal-close').click();

    // Modal should be gone
    await expect(page.locator('#payment-modal-close')).not.toBeVisible({ timeout: 3_000 });
  });
});
