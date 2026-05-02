/**
 * __tests__/unit/admin-payment-actions.test.ts
 *
 * Tests unitarios para las server actions de pagos manuales:
 * - approveManualPayment
 * - rejectManualPayment
 *
 * La capa de Supabase se mockea completamente — tests sin red/BD.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockSingle     = vi.fn();
const mockEq         = vi.fn(() => ({ single: mockSingle }));
const mockSelect     = vi.fn(() => ({ eq: mockEq, single: mockSingle }));
const mockUpdate     = vi.fn(() => ({ eq: mockEq }));
const mockInsert     = vi.fn().mockResolvedValue({ error: null });
const mockGetUser    = vi.fn();
const mockFrom       = vi.fn();

const buildFrom = (cfg: {
  getUserData?: { user: { id: string } } | null;
  callerRole?: string;
  invoiceData?: Record<string, unknown> | null;
  invoiceError?: { message: string } | null;
  bizError?: { message: string } | null;
}) => {
  return (table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { role: cfg.callerRole ?? 'platform_admin' }, error: null }),
          }),
        }),
      };
    }
    if (table === 'saas_invoices') {
      return {
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: cfg.invoiceData ?? { id: 'inv-1', business_id: 'biz-1', plan_purchased: 'pro' },
                  error: cfg.invoiceError ?? null,
                }),
            }),
          }),
        }),
      };
    }
    if (table === 'businesses') {
      return {
        update: () => ({
          eq: () => Promise.resolve({ error: cfg.bizError ?? null }),
        }),
      };
    }
    if (table === 'notifications') {
      return { insert: mockInsert };
    }
    return { select: mockSelect, update: mockUpdate, insert: mockInsert };
  };
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { approveManualPayment, rejectManualPayment } from '@/app/[locale]/dashboard/admin/payments/actions';

const mockCreateClient      = createClient as unknown as ReturnType<typeof vi.fn>;
const mockCreateAdminClient = createAdminClient as unknown as ReturnType<typeof vi.fn>;

const buildClientMock = (userId = 'admin-uid') => ({
  auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
  from: vi.fn(),
});

// ─── approveManualPayment ─────────────────────────────────────────────────────

describe('approveManualPayment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns { error: "Unauthorized" } when no user is logged in', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: vi.fn(),
    });

    const result = await approveManualPayment('inv-1');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('returns { error: "Forbidden" } for non-admin users', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'owner' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    const result = await approveManualPayment('inv-1');
    expect(result).toEqual({ error: 'Forbidden' });
  });

  it('returns { success: true } for valid admin approval', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'platform_admin' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    mockCreateAdminClient.mockReturnValue({
      from: buildFrom({
        invoiceData: { id: 'inv-1', business_id: 'biz-1', plan_purchased: 'pro' },
      }),
    });

    const result = await approveManualPayment('inv-1');
    expect(result).toEqual({ success: true });
  });

  it('returns error when invoice is not found', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'platform_admin' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    mockCreateAdminClient.mockReturnValue({
      from: buildFrom({
        invoiceData: null,
        invoiceError: { message: 'Not found' },
      }),
    });

    const result = await approveManualPayment('bad-id');
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
  });

  it('returns error when business update fails', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'platform_admin' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    mockCreateAdminClient.mockReturnValue({
      from: buildFrom({
        invoiceData: { id: 'inv-1', business_id: 'biz-1', plan_purchased: 'pro' },
        bizError:    { message: 'DB constraint' },
      }),
    });

    const result = await approveManualPayment('inv-1');
    expect(result.error).toBeTruthy();
  });
});

// ─── rejectManualPayment ──────────────────────────────────────────────────────

describe('rejectManualPayment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns { error: "Unauthorized" } when no user', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: vi.fn(),
    });

    const result = await rejectManualPayment('inv-1', 'Referencia no encontrada');
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('returns { error: "Forbidden" } for non-admin', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'employee' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    const result = await rejectManualPayment('inv-1', 'reason');
    expect(result).toEqual({ error: 'Forbidden' });
  });

  it('returns { success: true } for valid admin rejection', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'platform_admin' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    mockCreateAdminClient.mockReturnValue({
      from: buildFrom({
        invoiceData: { id: 'inv-1', business_id: 'biz-1', plan_purchased: 'pro' },
      }),
    });

    const result = await rejectManualPayment('inv-1', 'Referencia no encontrada');
    expect(result).toEqual({ success: true });
  });

  it('returns error when invoice is not found', async () => {
    const client = buildClientMock();
    client.from = buildFrom({ callerRole: 'platform_admin' }) as typeof client.from;
    mockCreateClient.mockResolvedValue(client);

    mockCreateAdminClient.mockReturnValue({
      from: buildFrom({
        invoiceData: null,
        invoiceError: { message: 'Not found' },
      }),
    });

    const result = await rejectManualPayment('bad-id', 'reason');
    expect(result.error).toBeTruthy();
  });
});
