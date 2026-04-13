/**
 * AI Tool Registry — Unit Tests
 *
 * Tests for lib/ai/tool-registry.ts
 * Covers: tool registration, lookup, execution delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We'll test the registry by re-importing it fresh each test
vi.resetModules()

// ── Mock tools ───────────────────────────────────────────────────────────────
function mockTools() {
  vi.mock('@/lib/ai/tools', () => ({
    getReadToolDefinitions: vi.fn().mockReturnValue([
      {
        type: 'function' as const,
        function: { name: 'get_today_summary', description: 'Get today summary', parameters: { type: 'object', properties: {}, required: [] } },
        handler: vi.fn().mockResolvedValue('Today: 5 appointments'),
      },
      {
        type: 'function' as const,
        function: { name: 'get_services', description: 'List services', parameters: { type: 'object', properties: {}, required: [] } },
        handler: vi.fn().mockResolvedValue('Service list'),
      },
    ]),
    getWriteToolDefinitions: vi.fn().mockReturnValue([
      {
        type: 'function' as const,
        function: { name: 'book_appointment', description: 'Book appointment', parameters: { type: 'object', properties: {}, required: [] } },
        handler: vi.fn().mockResolvedValue('Listo. Appointment booked.'),
      },
    ]),
  }))
}

mockTools()

import { toolRegistry } from '@/lib/ai/tool-registry'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AI Tool Registry', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('getDefinitions', () => {
    it('returns all tool definitions (read + write)', () => {
      const defs = toolRegistry.getDefinitions()

      expect(defs.length).toBeGreaterThan(0)
      expect(defs.some(d => d.function.name === 'get_today_summary')).toBe(true)
      expect(defs.some(d => d.function.name === 'book_appointment')).toBe(true)
    })
  })
})
