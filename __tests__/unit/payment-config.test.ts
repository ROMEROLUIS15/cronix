/**
 * __tests__/unit/payment-config.test.ts
 *
 * Tests unitarios para el SSOT de pagos (payment-config.ts).
 * Verifica que la configuración crítica de producción sea correcta
 * y que los tipos sean coherentes.
 *
 * NO tiene dependencias externas — puro TypeScript.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAN_CONFIG,
  PAGO_MOVIL_CONFIG,
  BINANCE_CONFIG,
  METHOD_META,
  type Plan,
  type AnyPaymentMethod,
  type ManualPaymentMethod,
} from '@/app/[locale]/dashboard/settings/payment-config';

// ─── PLAN_CONFIG ──────────────────────────────────────────────────────────────

describe('PLAN_CONFIG', () => {
  const plans: Plan[] = ['pro', 'enterprise'];

  it('should define all required plans', () => {
    expect(Object.keys(PLAN_CONFIG)).toEqual(expect.arrayContaining(plans));
  });

  it.each(plans)('%s — should have a positive amountUsd', (plan) => {
    expect(PLAN_CONFIG[plan].amountUsd).toBeGreaterThan(0);
  });

  it.each(plans)('%s — price string should include amountUsd', (plan) => {
    const cfg = PLAN_CONFIG[plan];
    expect(cfg.price).toContain(String(cfg.amountUsd));
  });

  it.each(plans)('%s — label should be non-empty', (plan) => {
    expect(PLAN_CONFIG[plan].label.trim().length).toBeGreaterThan(0);
  });

  it.each(plans)('%s — color should be a valid hex', (plan) => {
    expect(PLAN_CONFIG[plan].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('pro should cost less than enterprise', () => {
    expect(PLAN_CONFIG.pro.amountUsd).toBeLessThan(PLAN_CONFIG.enterprise.amountUsd);
  });

  it('pro plan should be $10 USDT', () => {
    expect(PLAN_CONFIG.pro.amountUsd).toBe(10);
    expect(PLAN_CONFIG.pro.price).toBe('$10 USDT');
  });

  it('enterprise plan should be $15 USDT', () => {
    expect(PLAN_CONFIG.enterprise.amountUsd).toBe(15);
    expect(PLAN_CONFIG.enterprise.price).toBe('$15 USDT');
  });
});

// ─── PAGO_MOVIL_CONFIG ────────────────────────────────────────────────────────

describe('PAGO_MOVIL_CONFIG', () => {
  it('should have a bankName', () => {
    expect(PAGO_MOVIL_CONFIG.bankName.trim().length).toBeGreaterThan(0);
  });

  it('phone should match Venezuelan mobile format', () => {
    // Accepts: 0424-709-2980, 04241234567, etc.
    expect(PAGO_MOVIL_CONFIG.phone).toMatch(/^04\d/);
  });

  it('cedula should start with V- prefix', () => {
    expect(PAGO_MOVIL_CONFIG.cedula).toMatch(/^V-/);
  });

  it('cedula digits should be numeric', () => {
    const digits = PAGO_MOVIL_CONFIG.cedula.replace(/[V\-\.]/g, '');
    expect(Number(digits)).toBeGreaterThan(0);
  });

  it('should use Bancamiga as the bank', () => {
    expect(PAGO_MOVIL_CONFIG.bankName).toBe('Bancamiga');
  });

  it('phone should be the configured production number', () => {
    expect(PAGO_MOVIL_CONFIG.phone).toBe('0424-709-2980');
  });
});

// ─── BINANCE_CONFIG ───────────────────────────────────────────────────────────

describe('BINANCE_CONFIG', () => {
  it('payId should be a numeric string', () => {
    expect(BINANCE_CONFIG.payId).toMatch(/^\d+$/);
  });

  it('payId should have at least 6 digits', () => {
    expect(BINANCE_CONFIG.payId.length).toBeGreaterThanOrEqual(6);
  });

  it('should have the configured production Pay ID', () => {
    expect(BINANCE_CONFIG.payId).toBe('550313419');
  });
});

// ─── METHOD_META ──────────────────────────────────────────────────────────────

describe('METHOD_META', () => {
  const allMethods: AnyPaymentMethod[] = ['nowpayments', 'pago_movil', 'binance_manual'];
  const manualMethods: ManualPaymentMethod[] = ['pago_movil', 'binance_manual'];

  it('should define all supported payment methods', () => {
    expect(Object.keys(METHOD_META)).toEqual(expect.arrayContaining(allMethods));
  });

  it.each(allMethods)('%s — should have non-empty label', (method) => {
    expect(METHOD_META[method].label.trim().length).toBeGreaterThan(0);
  });

  it.each(allMethods)('%s — should have non-empty subtitle', (method) => {
    expect(METHOD_META[method].subtitle.trim().length).toBeGreaterThan(0);
  });

  it.each(allMethods)('%s — color should be a Tailwind text class', (method) => {
    expect(METHOD_META[method].color).toMatch(/^text-/);
  });

  it('nowpayments should have an "Automático" badge', () => {
    expect(METHOD_META.nowpayments.badge).toBeDefined();
    expect(METHOD_META.nowpayments.badge).toBeTruthy();
  });

  it.each(manualMethods)('%s — should NOT have a badge (manual methods)', (method) => {
    expect(METHOD_META[method].badge).toBeUndefined();
  });

  it('nowpayments subtitle should mention blockchain', () => {
    expect(METHOD_META.nowpayments.subtitle.toLowerCase()).toContain('blockchain');
  });

  it('pago_movil subtitle should mention 24h', () => {
    expect(METHOD_META.pago_movil.subtitle).toContain('24h');
  });

  it('binance_manual subtitle should mention 24h', () => {
    expect(METHOD_META.binance_manual.subtitle).toContain('24h');
  });
});

// ─── Type-level consistency checks (compile-time) ────────────────────────────

describe('Type consistency', () => {
  it('all Plan keys should exist in PLAN_CONFIG', () => {
    const planKeys = Object.keys(PLAN_CONFIG) as Plan[];
    planKeys.forEach((key) => {
      expect(PLAN_CONFIG[key]).toBeDefined();
    });
  });

  it('ManualPaymentMethod should be a subset of AnyPaymentMethod keys in METHOD_META', () => {
    const manualMethods: ManualPaymentMethod[] = ['pago_movil', 'binance_manual'];
    manualMethods.forEach((m) => {
      expect(METHOD_META[m]).toBeDefined();
    });
  });
});
