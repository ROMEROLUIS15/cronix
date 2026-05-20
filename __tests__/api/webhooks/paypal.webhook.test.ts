/**
 * app/api/webhooks/paypal/route.ts — PayPal Webhook Tests
 *
 * Tests that:
 * - Valid signatures are accepted
 * - Invalid signatures are rejected (401)
 * - PAYMENT.CAPTURE.COMPLETED events are processed
 * - Other event types are ignored gracefully
 * - Missing order IDs are handled safely
 * - Duplicate events are idempotent
 * - Amount mismatches are flagged (fraud prevention)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/webhooks/paypal/route'

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockAdminClient = {
  from: vi.fn(),
  auth: { admin: {} },
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}))

// ── Mock PayPal verification ─────────────────────────────────────────────────
vi.mock('@/lib/payments/paypal', () => ({
  verifyWebhookSignature: vi.fn(),
}))

// ── Mock subscription fulfillment ────────────────────────────────────────────
vi.mock('@/lib/payments/subscription-fulfillment', () => ({
  finalizePayPalPayment: vi.fn(),
}))

import { verifyWebhookSignature } from '@/lib/payments/paypal'
import { finalizePayPalPayment } from '@/lib/payments/subscription-fulfillment'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PayPal Webhook (POST /api/webhooks/paypal)', () => {
  const validPaymentEvent = {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'capture-123',
      amount: { value: '29.99' },
      supplementary_data: {
        related_ids: { order_id: 'paypal-order-456' },
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when signature verification fails', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false)

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'invalid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.error).toBe('Invalid signature')
  })

  it('returns 400 for invalid JSON body', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: 'not-valid-json{',
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('processes PAYMENT.CAPTURE.COMPLETED event successfully', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'completed',
      invoiceId: 'inv-123',
      businessId: 'biz-456',
    })

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.result).toBe('completed')

    expect(finalizePayPalPayment).toHaveBeenCalledWith(
      mockAdminClient,
      'paypal-order-456',
      29.99
    )
  })

  it('returns success for already_processed event (idempotent)', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'already_processed',
    })

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.result).toBe('already_processed')
  })

  it('ignores non-PAYMENT.CAPTURE.COMPLETED events gracefully', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)

    const checkoutEvent = {
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: { id: 'order-789' },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(checkoutEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.received).toBe(true)
    expect(json.ignored).toBe('CHECKOUT.ORDER.APPROVED')
    expect(finalizePayPalPayment).not.toHaveBeenCalled()
  })

  it('returns 200 (safe) when order_id is missing', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)

    const eventWithoutOrderId = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'capture-123',
        amount: { value: '29.99' },
        supplementary_data: {
          related_ids: {},
        },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(eventWithoutOrderId),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.received).toBe(true)
    expect(json.missing).toBe('order_id')
    expect(finalizePayPalPayment).not.toHaveBeenCalled()
  })

  it('returns 200 when invoice is not found', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'invoice_not_found',
    })

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.received).toBe(true)
    expect(json.missing).toBe('invoice')
  })

  it('returns 400 for amount mismatch (fraud prevention)', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'amount_mismatch',
      expected: 29.99,
      captured: 19.99,
    })

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe('Amount mismatch')
  })

  it('returns 500 for database errors', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'db_error',
      message: 'Failed to update invoice status',
    })

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(validPaymentEvent),
    })

    const response = await POST(request as NextRequest)

    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json.error).toBe('DB error')
  })

  it('extracts amount correctly from resource.amount', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'completed',
      invoiceId: 'inv-999',
      businessId: 'biz-999',
    })

    const eventWithAmount = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'capture-999',
        amount: { value: '99.99' },
        supplementary_data: {
          related_ids: { order_id: 'order-999' },
        },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(eventWithAmount),
    })

    await POST(request)

    expect(finalizePayPalPayment).toHaveBeenCalledWith(
      mockAdminClient,
      'order-999',
      99.99
    )
  })

  it('handles missing amount gracefully (null)', async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true)
    vi.mocked(finalizePayPalPayment).mockResolvedValue({
      status: 'completed',
      invoiceId: 'inv-123',
      businessId: 'biz-123',
    })

    const eventWithoutAmount = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'capture-123',
        supplementary_data: {
          related_ids: { order_id: 'order-123' },
        },
      },
    }

    const request = new Request('http://localhost/api/webhooks/paypal', {
      method: 'POST',
      headers: { 'Paypal-Transmission-Sig': 'valid-sig' },
      body: JSON.stringify(eventWithoutAmount),
    })

    await POST(request)

    expect(finalizePayPalPayment).toHaveBeenCalledWith(
      mockAdminClient,
      'order-123',
      null
    )
  })
})
