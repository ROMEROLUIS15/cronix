/**
 * check-subscriptions.test.ts — Cron that downgrades expired paid plans to free.
 *
 * Covers the expiration query (non-free + past subscription_ends_at), the batch
 * downgrade, the empty case and both failure paths. QStash verifier mocked as a
 * pass-through so the handler runs directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/qstash/dist/nextjs', () => ({
  verifySignatureAppRouter: (handler: (req: Request) => Promise<Response>) => handler,
}))

// Chainable Supabase builder — select path ends at .lt(), update path ends at .in().
// Hoisted: the route calls createClient() at module top-level (factory runs on import).
const { mockLt, mockIn, mockNeq, mockUpdate, mockFrom } = vi.hoisted(() => {
  const mockLt = vi.fn()
  const mockIn = vi.fn()
  const mockNeq = vi.fn(() => ({ lt: mockLt }))
  const mockSelect = vi.fn(() => ({ neq: mockNeq }))
  const mockUpdate = vi.fn(() => ({ in: mockIn }))
  const mockFrom = vi.fn(() => ({ select: mockSelect, update: mockUpdate }))
  return { mockLt, mockIn, mockNeq, mockUpdate, mockFrom }
})
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

import { POST } from '@/app/api/cron/check-subscriptions/route'

const req = () => new Request('http://localhost/api/cron/check-subscriptions', { method: 'POST' })

describe('check-subscriptions cron (POST)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIn.mockResolvedValue({ error: null })
  })

  it('queries only non-free plans whose subscription already expired', async () => {
    mockLt.mockResolvedValueOnce({ data: [], error: null })

    await POST(req())

    expect(mockFrom).toHaveBeenCalledWith('businesses')
    expect(mockNeq).toHaveBeenCalledWith('plan', 'free')
    expect(mockLt).toHaveBeenCalledWith('subscription_ends_at', expect.any(String))
  })

  it('returns downgraded:0 and never updates when nothing expired', async () => {
    mockLt.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(req())
    const body = await res.json()

    expect(body).toEqual(expect.objectContaining({ success: true, downgraded: 0 }))
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('downgrades expired businesses to free in one batch', async () => {
    mockLt.mockResolvedValueOnce({ data: [{ id: 'b1' }, { id: 'b2' }], error: null })

    const res = await POST(req())
    const body = await res.json()

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free' }))
    expect(mockIn).toHaveBeenCalledWith('id', ['b1', 'b2'])
    expect(body).toEqual(expect.objectContaining({ success: true, downgraded: 2, businesses: ['b1', 'b2'] }))
  })

  it('returns 500 when the fetch fails', async () => {
    mockLt.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 500 when the downgrade update fails', async () => {
    mockLt.mockResolvedValueOnce({ data: [{ id: 'b1' }], error: null })
    mockIn.mockResolvedValueOnce({ error: { message: 'update failed' } })
    const res = await POST(req())
    expect(res.status).toBe(500)
  })
})
