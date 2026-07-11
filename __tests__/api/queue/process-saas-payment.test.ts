/**
 * process-saas-payment.test.ts — QStash worker that finalizes crypto (NOWPayments) SaaS payments.
 *
 * Covers the money-critical branches of fn_finalize_crypto_payment's result:
 * validation, idempotency (already_processed), completion side effects, partial
 * payments and RPC failure. The QStash signature verifier is mocked as a
 * pass-through so we exercise the handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// QStash verifier → pass-through (the route wraps handler in verifySignatureAppRouter)
vi.mock('@upstash/qstash/dist/nextjs', () => ({
  verifySignatureAppRouter: (handler: (req: Request) => Promise<Response>) => handler,
}))

// Hoisted so the mock factory can reference these — the route calls
// createAdminClient() at module top-level, which runs the factory during import.
const { mockRpc, mockInsert, mockFrom, mockSendReferralBonusPush } = vi.hoisted(() => {
  const mockInsert = vi.fn()
  return {
    mockRpc: vi.fn(),
    mockInsert,
    mockFrom: vi.fn(() => ({ insert: mockInsert })),
    mockSendReferralBonusPush: vi.fn(),
  }
})
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}))
vi.mock('@/lib/payments/subscription-fulfillment', () => ({
  sendReferralBonusPush: (...args: unknown[]) => mockSendReferralBonusPush(...args),
}))

import { POST } from '@/app/api/queue/process-saas-payment/route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/queue/process-saas-payment', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('process-saas-payment (POST)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
  })

  it('returns 400 when invoice_id is missing', async () => {
    const res = await POST(req({ payment_status: 'finished' }))
    expect(res.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('maps payment_status and calls the atomic finalize RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ result_status: 'updated', invoice_status: 'confirming' }], error: null })

    await POST(req({ invoice_id: 'inv-1', payment_id: 'pay-1', payment_status: 'confirming' }))

    expect(mockRpc).toHaveBeenCalledWith('fn_finalize_crypto_payment', expect.objectContaining({
      p_np_invoice_id: 'inv-1',
      p_np_payment_id: 'pay-1',
      p_status: 'confirming', // 'confirming' payment_status → 'confirming' invoice status
    }))
  })

  it('is idempotent: already_processed returns success without side effects', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ result_status: 'already_processed' }], error: null })

    const res = await POST(req({ invoice_id: 'inv-1', payment_status: 'finished' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, idempotent: true })
    expect(mockFrom).not.toHaveBeenCalled() // no notification insert on replay
  })

  it('on completed: inserts a confirmation notification and fires referral push when applicable', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        result_status: 'completed',
        business_id: 'biz-1',
        invoice_id: 'inv-1',
        plan_purchased: 'pro',
        referral_bonus_applied: true,
        referrer_business_id: 'ref-biz-9',
      }],
      error: null,
    })

    const res = await POST(req({ invoice_id: 'inv-1', payment_status: 'finished' }))

    expect(res.status).toBe(200)
    expect(mockFrom).toHaveBeenCalledWith('notifications')
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'biz-1', type: 'success' }))
    expect(mockSendReferralBonusPush).toHaveBeenCalledWith('ref-biz-9')
  })

  it('on completed without referral: does not fire the referral push', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ result_status: 'completed', business_id: 'biz-1', invoice_id: 'inv-1', plan_purchased: 'pro', referral_bonus_applied: false }],
      error: null,
    })

    await POST(req({ invoice_id: 'inv-1', payment_status: 'finished' }))
    expect(mockSendReferralBonusPush).not.toHaveBeenCalled()
  })

  it('on partially_paid update: inserts a warning notification', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ result_status: 'updated', invoice_status: 'partially_paid', business_id: 'biz-1', invoice_id: 'inv-1' }],
      error: null,
    })

    await POST(req({ invoice_id: 'inv-1', payment_status: 'partially_paid', actually_paid: 0.5, pay_currency: 'btc' }))
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }))
  })

  it('returns 404 when the invoice is not found', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ result_status: 'invoice_not_found' }], error: null })
    const res = await POST(req({ invoice_id: 'ghost', payment_status: 'finished' }))
    expect(res.status).toBe(404)
  })

  it('returns 500 when the finalize RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'deadlock' } })
    const res = await POST(req({ invoice_id: 'inv-1', payment_status: 'finished' }))
    expect(res.status).toBe(500)
  })
})
