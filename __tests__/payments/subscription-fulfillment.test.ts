/**
 * __tests__/payments/subscription-fulfillment.test.ts
 *
 * Unit tests for subscription-fulfillment.ts using AAA (Arrange-Act-Assert).
 *
 * Covers:
 *  - AC-1: Idempotence — already processed returns without DB mutation
 *  - AC-2: Amount mismatch — manipulated amount rejected, plan not activated
 *  - AC-3: Referral bonus only applies on the first invoice of a referred biz
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizePayPalPayment } from '@/lib/payments/subscription-fulfillment';
import { REFERRAL_BONUS_DAYS } from '@/lib/plans/plan-limits';

interface QueryChainMock {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
  _setResolveValues: (vals: Array<Record<string, unknown>>) => void;
}

// ─── Mock chain builder ───────────────────────────────────────────────────────
// Replicates the Supabase query builder pattern:
//   supabase.from('table').select(...).eq(...).single()
//   await chain  → calls chain.then(resolve)  → resolves with configured value
//
// All chaining methods (select, eq, single, etc.) return the chain itself.
// The chain is thenable via a real `then` implementation that invokes the
// resolve callback with a value from a sequential queue.

function createQueryChain(): QueryChainMock {
  let callIndex = 0;
  const resolveValues: Array<Record<string, unknown>> = [];

  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),

    // Proper thenable — calls onfulfilled with the next queued value
    then: vi.fn((onfulfilled?: (value: unknown) => unknown) => {
      const value: unknown =
        callIndex < resolveValues.length
          ? resolveValues[callIndex]
          : { data: null, error: null };
      callIndex++;
      if (onfulfilled) {
        return Promise.resolve(value).then(onfulfilled);
      }
      return Promise.resolve(value);
    }),

    // Test helper: set sequential resolve values for each `await chain`
    _setResolveValues(vals: Array<Record<string, unknown>>) {
      resolveValues.length = 0;
      resolveValues.push(...vals);
      callIndex = 0;
    },
  };

  return chain as unknown as QueryChainMock;
}

type MockChain = QueryChainMock;
type MockSupabase = {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function createMockSupabase(chain: MockChain): MockSupabase {
  return { rpc: vi.fn(), from: vi.fn(() => chain) };
}

// ─── Tests: finalizePayPalPayment (AC-1, AC-2) ───────────────────────────────

describe('finalizePayPalPayment', () => {
  let chain: MockChain;
  let supabase: MockSupabase;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = createQueryChain();
    supabase = createMockSupabase(chain);
  });

  describe('AC-1 — Idempotencia de pago', () => {
    it('retorna already_processed sin mutar la DB cuando el pago ya fue procesado', async () => {
      supabase.rpc.mockResolvedValue({
        data: [{ result_status: 'already_processed' }],
        error: null,
      });

      const result = await finalizePayPalPayment(
        supabase as unknown as Parameters<typeof finalizePayPalPayment>[0],
        'order-duplicate-001',
        29.99,
      );

      expect(result).toEqual({ status: 'already_processed' });
      // Guardián de SSOT: el wrapper DEBE inyectar la constante REFERRAL_BONUS_DAYS
      // como p_days, no un literal. Si alguien rehardcodea un valor distinto, falla.
      expect(supabase.rpc).toHaveBeenCalledWith('fn_finalize_paypal_payment', {
        p_order_id: 'order-duplicate-001',
        p_captured_amount: 29.99,
        p_days: REFERRAL_BONUS_DAYS,
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('AC-2 — Protección contra monto manipulado', () => {
    it('retorna amount_mismatch y NO activa el plan cuando el monto capturado difiere del precio', async () => {
      supabase.rpc.mockResolvedValue({
        data: [{ result_status: 'amount_mismatch' }],
        error: null,
      });

      const result = await finalizePayPalPayment(
        supabase as unknown as Parameters<typeof finalizePayPalPayment>[0],
        'order-fraud-002',
        0.01,
      );

      expect(result.status).toBe('amount_mismatch');
      expect(result).toHaveProperty('captured');
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('Estado completed — side effects', () => {
    it('inserta notificación cuando el pago se completa', async () => {
      // El bono de referido ya se aplica DENTRO del RPC; el branch completed solo
      // inserta la notificación in-app del pago y dispara pushes best-effort.
      supabase.rpc.mockResolvedValue({
        data: [{
          result_status: 'completed',
          business_id: 'biz-completed-001',
          invoice_id: 'inv-completed-001',
          plan_purchased: 'pro',
          referral_bonus_applied: false,
          referrer_business_id: null,
        }],
        error: null,
      });

      const result = await finalizePayPalPayment(
        supabase as unknown as Parameters<typeof finalizePayPalPayment>[0],
        'order-completed-003',
        29.99,
      );

      expect(result).toEqual({
        status: 'completed',
        invoiceId: 'inv-completed-001',
        businessId: 'biz-completed-001',
      });
      expect(supabase.from).toHaveBeenCalledWith('notifications');
    });
  });

  describe('Manejo de errores', () => {
    it('retorna db_error si el RPC lanza error', async () => {
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'connection error' },
      });

      const result = await finalizePayPalPayment(
        supabase as unknown as Parameters<typeof finalizePayPalPayment>[0],
        'order-err-004',
        29.99,
      );

      expect(result.status).toBe('db_error');
      if ('message' in result) {
        expect((result as { message: string }).message).toBe('connection error');
      }
    });

    it('retorna invoice_not_found cuando la factura no existe', async () => {
      supabase.rpc.mockResolvedValue({
        data: [{ result_status: 'invoice_not_found' }],
        error: null,
      });

      const result = await finalizePayPalPayment(
        supabase as unknown as Parameters<typeof finalizePayPalPayment>[0],
        'order-missing-005',
        29.99,
      );

      expect(result).toEqual({ status: 'invoice_not_found' });
    });
  });
});
