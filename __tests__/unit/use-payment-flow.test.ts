/**
 * __tests__/unit/use-payment-flow.test.ts
 *
 * Tests unitarios para el hook usePaymentFlow.
 * Verifica toda la lógica de estado del flujo de pago sin dependencia de UI.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaymentFlow } from '@/app/[locale]/dashboard/settings/use-payment-flow';

vi.mock('@/app/[locale]/dashboard/settings/actions', () => ({
  createSaaSCheckoutSession: vi.fn(),
  submitManualPayment: vi.fn(),
}));

import {
  createSaaSCheckoutSession,
  submitManualPayment,
} from '@/app/[locale]/dashboard/settings/actions';

const mockCreateSession = createSaaSCheckoutSession as Mock;
const mockSubmitManual  = submitManualPayment as Mock;

const renderFlow = (plan: 'pro' | 'enterprise' = 'pro', onClose = vi.fn()) =>
  renderHook(() => usePaymentFlow(plan, onClose));

// ─── Initial state ────────────────────────────────────────────────────────────

describe('usePaymentFlow — initial state', () => {
  it('starts at choose_method', () => {
    const { result } = renderFlow();
    expect(result.current.step).toBe('choose_method');
  });

  it('defaults method to nowpayments', () => {
    const { result } = renderFlow();
    expect(result.current.method).toBe('nowpayments');
  });

  it('starts with loading=false, error=null, reference=""', () => {
    const { result } = renderFlow();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.reference).toBe('');
  });
});

// ─── setMethod / setReference ─────────────────────────────────────────────────

describe('usePaymentFlow — setMethod / setReference', () => {
  it('updates method', () => {
    const { result } = renderFlow();
    act(() => { result.current.setMethod('pago_movil'); });
    expect(result.current.method).toBe('pago_movil');
  });

  it('updates reference', () => {
    const { result } = renderFlow();
    act(() => { result.current.setReference('12345678'); });
    expect(result.current.reference).toBe('12345678');
  });
});

// ─── goBack ───────────────────────────────────────────────────────────────────

describe('usePaymentFlow — goBack', () => {
  it('returns to choose_method and clears error', async () => {
    const { result } = renderFlow();
    act(() => { result.current.setMethod('pago_movil'); });
    await act(async () => { await result.current.handleContinue(); });
    expect(result.current.step).toBe('manual_form');

    act(() => { result.current.goBack(); });
    expect(result.current.step).toBe('choose_method');
    expect(result.current.error).toBeNull();
  });
});

// ─── handleContinue — nowpayments ─────────────────────────────────────────────

describe('usePaymentFlow — handleContinue (nowpayments)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens invoice_url and calls onClose on success', async () => {
    const onClose = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockCreateSession.mockResolvedValue({ invoice_url: 'https://pay.example.com/123' });

    const { result } = renderFlow('pro', onClose);
    await act(async () => { await result.current.handleContinue(); });

    expect(openSpy).toHaveBeenCalledWith('https://pay.example.com/123', '_blank', 'noopener,noreferrer');
    expect(onClose).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    openSpy.mockRestore();
  });

  it('sets error if session creation fails', async () => {
    mockCreateSession.mockResolvedValue({ error: 'Payment provider error' });
    const { result } = renderFlow();
    await act(async () => { await result.current.handleContinue(); });

    expect(result.current.error).toBe('Payment provider error');
    expect(result.current.loading).toBe(false);
  });

  it('passes correct plan to createSaaSCheckoutSession', async () => {
    mockCreateSession.mockResolvedValue({ invoice_url: 'https://pay.example.com' });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    const { result } = renderFlow('enterprise');
    await act(async () => { await result.current.handleContinue(); });
    expect(mockCreateSession).toHaveBeenCalledWith('enterprise');
  });
});

// ─── handleContinue — manual methods ─────────────────────────────────────────

describe('usePaymentFlow — handleContinue (manual methods)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('transitions to manual_form for pago_movil (no API call)', async () => {
    const { result } = renderFlow();
    act(() => { result.current.setMethod('pago_movil'); });
    await act(async () => { await result.current.handleContinue(); });

    expect(result.current.step).toBe('manual_form');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('transitions to manual_form for binance_manual (no API call)', async () => {
    const { result } = renderFlow();
    act(() => { result.current.setMethod('binance_manual'); });
    await act(async () => { await result.current.handleContinue(); });

    expect(result.current.step).toBe('manual_form');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

// ─── handleSubmitManual ───────────────────────────────────────────────────────

describe('usePaymentFlow — handleSubmitManual', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const goToManualForm = async (result: ReturnType<typeof renderFlow>['result']) => {
    act(() => { result.current.setMethod('pago_movil'); });
    await act(async () => { await result.current.handleContinue(); });
  };

  it('sets error if reference is empty', async () => {
    const { result } = renderFlow();
    await goToManualForm(result);
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(result.current.error).toBeTruthy();
    expect(result.current.step).toBe('manual_form');
    expect(mockSubmitManual).not.toHaveBeenCalled();
  });

  it('sets error if reference is fewer than 4 chars', async () => {
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('123'); });
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(result.current.error).toBeTruthy();
    expect(mockSubmitManual).not.toHaveBeenCalled();
  });

  it('accepts reference of exactly 4 chars and succeeds', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('1234'); });
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(result.current.step).toBe('manual_success');
    expect(result.current.error).toBeNull();
  });

  it('transitions to manual_success on successful submission', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('98765432'); });
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(result.current.step).toBe('manual_success');
  });

  it('sets error if submit returns error', async () => {
    mockSubmitManual.mockResolvedValue({ error: 'Server error' });
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('98765432'); });
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(result.current.error).toBe('Server error');
    expect(result.current.step).toBe('manual_form');
  });

  it('calls submitManualPayment with trimmed reference and correct plan/method', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    const { result } = renderFlow('enterprise');
    act(() => { result.current.setMethod('binance_manual'); });
    await act(async () => { await result.current.handleContinue(); });
    act(() => { result.current.setReference('  AB12CD  '); });
    await act(async () => { await result.current.handleSubmitManual(); });

    expect(mockSubmitManual).toHaveBeenCalledWith({
      plan:            'enterprise',
      method:          'binance_manual',
      referenceNumber: 'AB12CD',
    });
  });

  it('resets loading to false after success', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('98765432'); });
    await act(async () => { await result.current.handleSubmitManual(); });
    expect(result.current.loading).toBe(false);
  });

  it('resets loading to false after error', async () => {
    mockSubmitManual.mockResolvedValue({ error: 'fail' });
    const { result } = renderFlow();
    await goToManualForm(result);
    act(() => { result.current.setReference('98765432'); });
    await act(async () => { await result.current.handleSubmitManual(); });
    expect(result.current.loading).toBe(false);
  });
});
