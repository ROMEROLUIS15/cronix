/**
 * Health API Route — Unit Tests
 *
 * Tests for app/api/health/route.ts
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockFromSelect = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({
      select: mockFromSelect,
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}))

// ── Mock circuit breaker ─────────────────────────────────────────────────────
vi.mock('@/lib/ai/circuit-breaker', () => ({
  aiCircuit: {
    getDiagnostic: () => ({
      STT: 'CLOSED',
      LLM: 'CLOSED',
      TTS: 'CLOSED',
    }),
  },
}))

import { GET } from '@/app/api/health/route'

// ── Tests ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env }

describe('Health API Route', () => {
  beforeAll(() => {
    process.env.LLM_API_KEY = 'test-llm-key'
    process.env.DEEPGRAM_AURA_API_KEY = 'test-deepgram-key'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  })

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockFromSelect.mockResolvedValue({ data: [], error: null })
  })

  it('returns 200 with healthy status when all systems are operational', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('healthy')
    expect(body.diagnostics.database).toBe('connected')
    expect(body.diagnostics.environment).toBe('ok')
    expect(body.diagnostics.ai_circuits).toEqual({ STT: 'CLOSED', LLM: 'CLOSED', TTS: 'CLOSED' })
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('latency_ms')
    expect(typeof body.latency_ms).toBe('number')
  })

  it('returns degraded status when database query fails', async () => {
    mockFromSelect.mockResolvedValue({ data: null, error: { message: 'connection refused' } })

    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.diagnostics.database).toContain('connection refused')
  })

  it('returns 500 with unhealthy status on unexpected error', async () => {
    mockFromSelect.mockRejectedValue(new Error('Unexpected crash'))

    const response = await GET()

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.status).toBe('unhealthy')
  })

  it('includes the AI circuit breaker diagnostic', async () => {
    const response = await GET()
    const body = await response.json()

    expect(body.diagnostics.ai_circuits).toBeDefined()
    expect(body.diagnostics.ai_circuits).toHaveProperty('STT')
    expect(body.diagnostics.ai_circuits).toHaveProperty('LLM')
    expect(body.diagnostics.ai_circuits).toHaveProperty('TTS')
  })
})
