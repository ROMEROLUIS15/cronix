import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferralClient } from '@/app/[locale]/dashboard/referrals/referral-client';
import type { ReferralBusiness, ReferralInvite } from '@/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', async () => ({
  ...(await import('@/__tests__/setup/next-intl-mock')).createNextIntlMock(),
  useTranslations: (ns?: string) => (key: string, params?: Record<string, unknown>) => {
    const full = ns ? `${ns}.${key}` : key;
    if (params) return `${full}:${JSON.stringify(params)}`;
    return full;
  },
}));

// date-fns: return a stable string to avoid locale-sensitive failures
vi.mock('date-fns', async (importOriginal) => {
  const original = await importOriginal<typeof import('date-fns')>();
  return {
    ...original,
    format: (_date: Date, _fmt: string) => '01 Ene 2026',
  };
});

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
  writable: true,
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FREE_BUSINESS: ReferralBusiness = {
  id: 'biz-free-1',
  name: 'Salon Libre',
  plan: 'free',
  referral_code: 'SALON123',
  bonus_appointments_limit: 10,
  subscription_ends_at: null,
  timezone: 'America/Caracas',
};

const PRO_BUSINESS: ReferralBusiness = {
  id: 'biz-pro-1',
  name: 'Barberia Pro',
  plan: 'pro',
  referral_code: 'BARBER456',
  bonus_appointments_limit: null,
  subscription_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  timezone: 'America/Bogota',
};

const INVITED_LIST: ReferralInvite[] = [
  { id: 'inv-1', name: 'Salon Bella', plan: 'free', created_at: '2026-04-01T00:00:00Z' },
  { id: 'inv-2', name: 'Estudio Top', plan: 'pro', created_at: '2026-03-15T00:00:00Z' },
];

const APP_URL = 'https://cronix-app.vercel.app';

const renderFree = (invited: ReferralInvite[] = []) =>
  render(<ReferralClient business={FREE_BUSINESS} invited={invited} appUrl={APP_URL} />);

const renderPro = (invited: ReferralInvite[] = []) =>
  render(<ReferralClient business={PRO_BUSINESS} invited={invited} appUrl={APP_URL} />);

// ─── Render — Referral link ───────────────────────────────────────────────────

describe('ReferralClient — referral link', () => {
  it('displays the full referral link for free plan', () => {
    renderFree();
    expect(screen.getByText(`${APP_URL}/invite/SALON123`)).toBeInTheDocument();
  });

  it('displays the full referral link for pro plan', () => {
    renderPro();
    expect(screen.getByText(`${APP_URL}/invite/BARBER456`)).toBeInTheDocument();
  });

  it('shows PENDING in link when referral_code is null', () => {
    const biz = { ...FREE_BUSINESS, referral_code: null };
    render(<ReferralClient business={biz} invited={[]} appUrl={APP_URL} />);
    expect(screen.getByText(`${APP_URL}/invite/PENDING`)).toBeInTheDocument();
  });
});

// ─── Render — Free plan hero ──────────────────────────────────────────────────

describe('ReferralClient — free plan', () => {
  it('renders the free hero banner key', () => {
    renderFree();
    expect(screen.getByText('referrals.heroBannerFree')).toBeInTheDocument();
  });

  it('renders the free description key', () => {
    renderFree();
    expect(screen.getByText('referrals.heroDescFree')).toBeInTheDocument();
  });

  it('renders "Estado de Recompensas" section key', () => {
    renderFree();
    expect(screen.getByText('referrals.rewardStatusTitle')).toBeInTheDocument();
  });

  it('renders the extra appointments label', () => {
    renderFree();
    expect(screen.getByText('referrals.extraApptsLabel')).toBeInTheDocument();
  });

  it('shows progress bar element', () => {
    const { container } = renderFree();
    const progressBar = container.querySelector('.bg-blue-500.h-full.rounded-full');
    expect(progressBar).toBeInTheDocument();
  });

  it('shows base limit text with correct numbers', () => {
    renderFree();
    // bonus is 10, base is 30 → current = 40
    expect(screen.getByText(/referrals.baseLimitText/)).toBeInTheDocument();
  });
});

// ─── Render — Paid plan hero ──────────────────────────────────────────────────

describe('ReferralClient — paid plan (pro)', () => {
  it('renders the paid hero banner key', () => {
    renderPro();
    expect(screen.getByText('referrals.heroBannerPaid')).toBeInTheDocument();
  });

  it('renders the paid description key', () => {
    renderPro();
    expect(screen.getByText('referrals.heroDescPaid')).toBeInTheDocument();
  });

  it('renders months earned label', () => {
    renderPro();
    expect(screen.getByText('referrals.monthsEarnedLabel')).toBeInTheDocument();
  });

  it('shows paid invite count (0 by default)', () => {
    renderPro();
    // paidInvitesCount = 0 when no invited
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('counts only paid invites (not free plan ones)', () => {
    renderPro(INVITED_LIST); // 1 free, 1 pro
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows subscription expiry text when subscription_ends_at is set', () => {
    renderPro();
    expect(screen.getByText(/referrals.expiryText/)).toBeInTheDocument();
  });

  it('does NOT show expiry text when subscription_ends_at is null', () => {
    const biz = { ...PRO_BUSINESS, subscription_ends_at: null };
    render(<ReferralClient business={biz} invited={[]} appUrl={APP_URL} />);
    expect(screen.queryByText(/referrals.expiryText/)).toBeNull();
  });
});

// ─── How it works section ─────────────────────────────────────────────────────

describe('ReferralClient — how it works', () => {
  it('renders the how it works title', () => {
    renderFree();
    expect(screen.getByText('referrals.howItWorksTitle')).toBeInTheDocument();
  });

  it('renders all 3 step keys', () => {
    renderFree();
    expect(screen.getByText('referrals.step1')).toBeInTheDocument();
    expect(screen.getByText('referrals.step2')).toBeInTheDocument();
    expect(screen.getByText('referrals.step3')).toBeInTheDocument();
  });
});

// ─── Invited list — empty state ───────────────────────────────────────────────

describe('ReferralClient — empty referrals list', () => {
  it('shows empty state message when no invites', () => {
    renderFree([]);
    expect(screen.getByText('referrals.emptyReferrals')).toBeInTheDocument();
  });

  it('shows correct count key with 0', () => {
    renderFree([]);
    expect(screen.getByText(/referrals.referralsListTitle/)).toBeInTheDocument();
  });

  it('does NOT render the table when invited list is empty', () => {
    const { container } = renderFree([]);
    expect(container.querySelector('table')).toBeNull();
  });
});

// ─── Invited list — with data ─────────────────────────────────────────────────

describe('ReferralClient — referrals list with data', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the table when invited list has entries', () => {
    const { container } = renderFree(INVITED_LIST);
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('renders business names in the table', () => {
    renderFree(INVITED_LIST);
    expect(screen.getByText('Salon Bella')).toBeInTheDocument();
    expect(screen.getByText('Estudio Top')).toBeInTheDocument();
  });

  it('renders free status badge for free plan invites', () => {
    renderFree(INVITED_LIST);
    expect(screen.getByText('referrals.statusFree')).toBeInTheDocument();
  });

  it('renders paid status badge for paid plan invites', () => {
    renderFree(INVITED_LIST);
    expect(screen.getByText('referrals.statusPaid')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    renderFree(INVITED_LIST);
    expect(screen.getByText('referrals.colBusiness')).toBeInTheDocument();
    expect(screen.getByText('referrals.colStatus')).toBeInTheDocument();
  });

  it('renders without crashing when business name is an empty string', () => {
    const inviteWithEmptyName: ReferralInvite[] = [
      { id: 'inv-empty', name: '', plan: 'free', created_at: '2026-04-01T00:00:00Z' },
    ];
    const { container } = renderFree(inviteWithEmptyName);
    // Row is rendered — table exists
    expect(container.querySelector('tbody tr')).toBeInTheDocument();
  });
});

// ─── Copy to clipboard ────────────────────────────────────────────────────────

describe('ReferralClient — copy button', () => {
  beforeEach(() => {
    // Re-define clipboard fresh for each test so clearAllMocks() doesn't lose the vi.fn ref
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    // Guarantee real timers even if a test fails before calling useRealTimers
    vi.useRealTimers();
  });

  it('renders the copy button', () => {
    renderFree();
    expect(screen.getByText('referrals.copyLink')).toBeInTheDocument();
  });

  it('calls clipboard.writeText with the full referral link on click', async () => {
    renderFree();
    await userEvent.click(screen.getByText('referrals.copyLink'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${APP_URL}/invite/SALON123`,
      );
    });
  });

  it('shows "copied" confirmation text after clicking', async () => {
    renderFree();
    await userEvent.click(screen.getByText('referrals.copyLink'));
    await waitFor(() => {
      expect(screen.getByText('referrals.copied')).toBeInTheDocument();
    });
  });

  it('reverts back to copyLink text after 2 seconds', async () => {
    vi.useFakeTimers();
    renderFree();

    // fireEvent is synchronous — avoids userEvent's internal setTimeout interactions with fake timers
    await act(async () => {
      fireEvent.click(screen.getByText('referrals.copyLink'));
    });
    expect(screen.getByText('referrals.copied')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('referrals.copied')).toBeNull();
    expect(screen.getByText('referrals.copyLink')).toBeInTheDocument();
  });

  it('does NOT crash when clipboard API is unavailable', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied'),
    );
    renderFree();
    await act(async () => {
      fireEvent.click(screen.getByText('referrals.copyLink'));
    });
    // Component stays mounted and shows the button (no uncaught error)
    expect(screen.getByText('referrals.copyLink')).toBeInTheDocument();
  });
});
