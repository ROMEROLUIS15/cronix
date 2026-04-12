/**
 * circuit-breaker.test.ts — Unit tests for AI service circuit breaker.
 *
 * Covers all state transitions:
 *   CLOSED → OPEN (after 5 failures)
 *   OPEN → HALF-OPEN (after cooldown)
 *   HALF-OPEN → CLOSED (on success)
 *   HALF-OPEN → OPEN (on failure)
 *
 * Also verifies 429 rate-limit responses don't count as failures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { aiCircuit } from '@/lib/ai/circuit-breaker'

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('AICircuitBreaker', () => {
  beforeEach(() => {
    // Reset internal state before each test
    aiCircuit.reportSuccess('STT')
    aiCircuit.reportSuccess('LLM')
    aiCircuit.reportSuccess('TTS')
  })

  // ── Initial State ────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts all services CLOSED', () => {
      const diag = aiCircuit.getDiagnostic()
      expect(diag.STT).toBe('CLOSED')
      expect(diag.LLM).toBe('CLOSED')
      expect(diag.TTS).toBe('CLOSED')
    })

    it('allows requests when CLOSED', () => {
      expect(aiCircuit.isAvailable('STT')).toBe(true)
      expect(aiCircuit.isAvailable('LLM')).toBe(true)
      expect(aiCircuit.isAvailable('TTS')).toBe(true)
    })
  })

  // ── CLOSED → OPEN (threshold breach) ─────────────────────────────────────
  describe('CLOSED → OPEN transition', () => {
    it('stays CLOSED with 4 failures (below threshold)', () => {
      for (let i = 0; i < 4; i++) {
        aiCircuit.reportFailure('STT')
      }
      expect(aiCircuit.isAvailable('STT')).toBe(true)
    })

    it('opens circuit on 5th failure (threshold)', () => {
      for (let i = 0; i < 5; i++) {
        aiCircuit.reportFailure('LLM')
      }
      const diag = aiCircuit.getDiagnostic()
      expect(diag.LLM).toBe('OPEN')
      expect(aiCircuit.isAvailable('LLM')).toBe(false)
    })

    it('keeps other services CLOSED when one opens', () => {
      for (let i = 0; i < 5; i++) aiCircuit.reportFailure('TTS')

      expect(aiCircuit.isAvailable('STT')).toBe(true)
      expect(aiCircuit.isAvailable('LLM')).toBe(true)
      expect(aiCircuit.isAvailable('TTS')).toBe(false)
    })
  })

  // ── OPEN → HALF-OPEN (cooldown expiry) ───────────────────────────────────
  describe('OPEN → HALF-OPEN transition', () => {
    it('blocks requests during cooldown', () => {
      for (let i = 0; i < 5; i++) aiCircuit.reportFailure('STT')

      // Within cooldown (5 min) — should be blocked
      vi.setSystemTime(Date.now() + 2 * 60 * 1000) // 2 minutes later
      expect(aiCircuit.isAvailable('STT')).toBe(false)
    })

    it('allows request after cooldown expires (HALF-OPEN)', () => {
      for (let i = 0; i < 5; i++) aiCircuit.reportFailure('LLM')

      // Past cooldown
      vi.setSystemTime(Date.now() + 6 * 60 * 1000) // 6 minutes later
      expect(aiCircuit.isAvailable('LLM')).toBe(true)
    })
  })

  // ── HALF-OPEN → CLOSED (recovery) ────────────────────────────────────────
  describe('HALF-OPEN → CLOSED recovery', () => {
    it('closes circuit on success after HALF-OPEN', () => {
      // Trip the circuit
      for (let i = 0; i < 5; i++) aiCircuit.reportFailure('TTS')

      // Wait for cooldown
      vi.setSystemTime(Date.now() + 6 * 60 * 1000)

      // Service is HALF-OPEN — simulate success
      expect(aiCircuit.isAvailable('TTS')).toBe(true)
      aiCircuit.reportSuccess('TTS')

      expect(aiCircuit.getDiagnostic().TTS).toBe('CLOSED')
      expect(aiCircuit.isAvailable('TTS')).toBe(true)
    })
  })

  // ── HALF-OPEN → OPEN (failure during probe) ──────────────────────────────
  describe('HALF-OPEN → OPEN on probe failure', () => {
    it('re-opens circuit if HALF-OPEN request fails', () => {
      for (let i = 0; i < 5; i++) aiCircuit.reportFailure('STT')

      vi.setSystemTime(Date.now() + 6 * 60 * 1000)
      aiCircuit.isAvailable('STT') // transitions to HALF-OPEN
      aiCircuit.reportFailure('STT') // probe fails

      expect(aiCircuit.getDiagnostic().STT).toBe('OPEN')
    })
  })

  // ── Rate Limit (429) Exclusion ───────────────────────────────────────────
  describe('429 rate-limit exclusion', () => {
    it('does not count rate_limit errors as failures', () => {
      for (let i = 0; i < 10; i++) {
        aiCircuit.reportFailure('LLM', { message: 'rate_limit_exceeded' })
      }

      // Circuit should still be CLOSED despite 10 "failures"
      expect(aiCircuit.isAvailable('LLM')).toBe(true)
      expect(aiCircuit.getDiagnostic().LLM).toBe('CLOSED')
    })

    it('does not count 429 JSON errors as failures', () => {
      for (let i = 0; i < 10; i++) {
        aiCircuit.reportFailure('LLM', { error: { code: 'rate_limit' } })
      }

      expect(aiCircuit.isAvailable('LLM')).toBe(true)
    })
  })

  // ── Success Resets Failure Count ─────────────────────────────────────────
  describe('success resets failure counter', () => {
    it('resets failure count on success', () => {
      // 4 failures
      for (let i = 0; i < 4; i++) aiCircuit.reportFailure('STT')

      // 1 success — resets counter
      aiCircuit.reportSuccess('STT')

      // 4 more failures — should NOT trip because counter was reset
      for (let i = 0; i < 4; i++) aiCircuit.reportFailure('STT')

      expect(aiCircuit.isAvailable('STT')).toBe(true)
    })
  })

  // ── Diagnostic ───────────────────────────────────────────────────────────
  describe('getDiagnostic', () => {
    it('returns state for all three services', () => {
      const diag = aiCircuit.getDiagnostic()
      expect(Object.keys(diag)).toEqual(['STT', 'LLM', 'TTS'])
    })
  })
})
