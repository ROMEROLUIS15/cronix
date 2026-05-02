import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentMethodModal } from '@/app/[locale]/dashboard/settings/payment-method-modal';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// next-intl: devuelve la key como valor (suficiente para verificar renders)
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string, params?: Record<string, string>) => {
    const full = ns ? `${ns}.${key}` : key;
    if (params) return `${full}:${JSON.stringify(params)}`;
    return full;
  },
}));

// Server actions — no queremos hits de red
vi.mock('@/app/[locale]/dashboard/settings/actions', () => ({
  createSaaSCheckoutSession: vi.fn(),
  submitManualPayment: vi.fn(),
}));

import {
  createSaaSCheckoutSession,
  submitManualPayment,
} from '@/app/[locale]/dashboard/settings/actions';

const mockCreateSession = createSaaSCheckoutSession as ReturnType<typeof vi.fn>;
const mockSubmitManual  = submitManualPayment as ReturnType<typeof vi.fn>;

// navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const renderModal = (plan: 'pro' | 'enterprise' = 'pro', onClose = vi.fn()) =>
  render(<PaymentMethodModal plan={plan} onClose={onClose} />);

// ─── Render — Modal structure ─────────────────────────────────────────────────

describe('PaymentMethodModal — render', () => {
  it('renders the modal dialog', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders close button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeInTheDocument();
  });

  it('renders all 3 payment method cards', () => {
    renderModal();
    // Each method has a unique button id
    expect(document.getElementById('method-nowpayments')).toBeInTheDocument();
    expect(document.getElementById('method-pago_movil')).toBeInTheDocument();
    expect(document.getElementById('method-binance_manual')).toBeInTheDocument();
  });

  it('renders continue button on step 1', () => {
    renderModal();
    expect(document.getElementById('payment-method-continue')).toBeInTheDocument();
  });

  it('does NOT render reference input on step 1', () => {
    renderModal();
    expect(document.getElementById('pago-movil-ref')).toBeNull();
    expect(document.getElementById('binance-ref')).toBeNull();
  });
});

// ─── Close button ─────────────────────────────────────────────────────────────

describe('PaymentMethodModal — close', () => {
  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderModal('pro', onClose);
    await userEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const { container } = renderModal('pro', onClose);
    // The outer backdrop div is the first child of the container
    const backdrop = container.firstElementChild as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT call onClose when modal body is clicked', async () => {
    const onClose = vi.fn();
    renderModal('pro', onClose);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── Method selection ─────────────────────────────────────────────────────────

describe('PaymentMethodModal — method selection', () => {
  it('selects pago_movil when its card is clicked', async () => {
    renderModal();
    const card = document.getElementById('method-pago_movil')!;
    await userEvent.click(card);
    // jsdom converts #0062FF → rgb(0, 98, 255)
    expect(card.style.border).toMatch(/0062FF|0, 98, 255/i);
  });

  it('selects binance_manual when its card is clicked', async () => {
    renderModal();
    const card = document.getElementById('method-binance_manual')!;
    await userEvent.click(card);
    expect(card.style.border).toMatch(/0062FF|0, 98, 255/i);
  });
});

// ─── Step 2: Pago Móvil form ──────────────────────────────────────────────────

describe('PaymentMethodModal — Pago Móvil form', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const goToPagoMovil = async () => {
    renderModal();
    await userEvent.click(document.getElementById('method-pago_movil')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
  };

  it('shows reference input after selecting pago_movil and continuing', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(document.getElementById('pago-movil-ref')).toBeInTheDocument();
    });
  });

  it('shows Bancamiga bank data', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(screen.getByText('Bancamiga')).toBeInTheDocument();
    });
  });

  it('shows phone data', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(screen.getByText('0424-709-2980')).toBeInTheDocument();
    });
  });

  it('shows cedula data', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(screen.getByText('V-15.295.575')).toBeInTheDocument();
    });
  });

  it('shows send reference button', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(document.getElementById('submit-pago-movil')).toBeInTheDocument();
    });
  });

  it('shows back button', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      expect(screen.getByText(/back/i)).toBeInTheDocument();
    });
  });

  it('copy buttons are rendered for each payment field', async () => {
    await goToPagoMovil();
    await waitFor(() => {
      // Each copyable DataRow has a CopyButton with aria-label containing "copy"
      const copyBtns = screen.getAllByRole('button', { name: /copy/i });
      // bank, phone, cedula, concept = at least 4 copy buttons
      expect(copyBtns.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('back button returns to method selection', async () => {
    await goToPagoMovil();
    await waitFor(() => expect(document.getElementById('pago-movil-ref')).toBeInTheDocument());

    const backBtn = screen.getByText(/back/i);
    await userEvent.click(backBtn);
    await waitFor(() => {
      expect(document.getElementById('payment-method-continue')).toBeInTheDocument();
      expect(document.getElementById('pago-movil-ref')).toBeNull();
    });
  });
});

// ─── Step 2: Binance form ─────────────────────────────────────────────────────

describe('PaymentMethodModal — Binance form', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const goToBinance = async () => {
    renderModal('enterprise');
    await userEvent.click(document.getElementById('method-binance_manual')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
  };

  it('shows binance reference input', async () => {
    await goToBinance();
    await waitFor(() => {
      expect(document.getElementById('binance-ref')).toBeInTheDocument();
    });
  });

  it('shows Binance Pay ID', async () => {
    await goToBinance();
    await waitFor(() => {
      expect(screen.getByText('550313419')).toBeInTheDocument();
    });
  });

  it('shows exact amount for enterprise plan', async () => {
    await goToBinance();
    await waitFor(() => {
      expect(screen.getByText('$15 USDT')).toBeInTheDocument();
    });
  });
});

// ─── Step 3: Success state ────────────────────────────────────────────────────

describe('PaymentMethodModal — success state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows success screen after valid pago_movil submission', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    renderModal();

    await userEvent.click(document.getElementById('method-pago_movil')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
    await waitFor(() => expect(document.getElementById('pago-movil-ref')).toBeInTheDocument());

    await userEvent.type(document.getElementById('pago-movil-ref')!, '12345678');
    await userEvent.click(document.getElementById('submit-pago-movil')!);

    await waitFor(() => {
      expect(document.getElementById('manual-payment-done')).toBeInTheDocument();
    });
  });

  it('done button calls onClose', async () => {
    mockSubmitManual.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<PaymentMethodModal plan="pro" onClose={onClose} />);

    await userEvent.click(document.getElementById('method-pago_movil')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
    await waitFor(() => expect(document.getElementById('pago-movil-ref')).toBeInTheDocument());

    await userEvent.type(document.getElementById('pago-movil-ref')!, '12345678');
    await userEvent.click(document.getElementById('submit-pago-movil')!);
    await waitFor(() => expect(document.getElementById('manual-payment-done')).toBeInTheDocument());

    await userEvent.click(document.getElementById('manual-payment-done')!);
    expect(onClose).toHaveBeenCalled();
  });
});

// ─── Error state ──────────────────────────────────────────────────────────────

describe('PaymentMethodModal — error handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows error when submitManualPayment returns an error', async () => {
    mockSubmitManual.mockResolvedValue({ error: 'Referencia inválida' });
    renderModal();

    await userEvent.click(document.getElementById('method-pago_movil')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
    await waitFor(() => expect(document.getElementById('pago-movil-ref')).toBeInTheDocument());

    await userEvent.type(document.getElementById('pago-movil-ref')!, '12345678');
    await userEvent.click(document.getElementById('submit-pago-movil')!);

    await waitFor(() => {
      expect(screen.getByText('Referencia inválida')).toBeInTheDocument();
    });
  });

  it('shows error when createSaaSCheckoutSession fails', async () => {
    mockCreateSession.mockResolvedValue({ error: 'Gateway timeout' });
    renderModal();

    await userEvent.click(document.getElementById('payment-method-continue')!);

    await waitFor(() => {
      expect(screen.getByText('Gateway timeout')).toBeInTheDocument();
    });
  });
});

// ─── CopyButton ───────────────────────────────────────────────────────────────

describe('PaymentMethodModal — CopyButton', () => {
  it('copies phone value to clipboard when copy button is clicked', async () => {
    renderModal();
    await userEvent.click(document.getElementById('method-pago_movil')!);
    await userEvent.click(document.getElementById('payment-method-continue')!);
    await waitFor(() => expect(screen.getByText('0424-709-2980')).toBeInTheDocument());

    // Find copy button next to phone field
    const copyBtns = screen.getAllByRole('button', { name: /copy.*phone/i });
    if (copyBtns[0]) {
      await userEvent.click(copyBtns[0]);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0424-709-2980');
    }
  });
});
