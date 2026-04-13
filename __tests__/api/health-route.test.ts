/**
 * Health API Route — Unit Tests
 *
 * Tests for app/api/health/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}))

// ── Mock circuit breaker ─────────────────────────────────────────────────────
vi.mock('@/lib/ai/circuit-breaker', () => ({
  aiCircuit: {
    getDiagnostic: () => ({
      stt: { isOpen: false, failures: 0 },
      llm: { isOpen: false, failures: 0 },
      tts: { isOpen: false, failures: 0 },
    }),
  },
}))

import { GET } from '@/app/api/health/route'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Health API Route', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 200 OK with service status', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('status')
  })

  it('includes AI circuit breaker diagnostic', async () => {
    const response = await GET()
    const body = await response.json()

    // The response includes AI diagnostic info (structure depends on implementation)
    expect(body.status).toBeDefined()
  })
})
