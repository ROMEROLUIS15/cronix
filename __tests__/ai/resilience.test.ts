// @ts-nocheck
/**
 * resilience.test.ts — Unit Tests for AI Resilience Layer
 *
 * Tests the retry/fallback logic for:
 * - STT (Speech to Text) with key rotation
 * - LLM (Large Language Model) with fallback models
 * - TTS (Text to Speech) with graceful degradation
 *
 * Uses mocked fetch to simulate API failures and success cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { safeSTT, safeLLM, safeTTS, safeDeepgramTTS } from '@/lib/ai/resilience'

// Mock the aiCircuit
vi.mock('@/lib/ai/circuit-breaker', () => ({
  aiCircuit: {
    isAvailable: vi.fn(() => true),
    reportSuccess: vi.fn(),
    reportFailure: vi.fn(),
  },
}))

// Mock the logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('Resilience — Safe AI Operations', () => {
  // ── Tests: safeSTT ───────────────────────────────────────────────────────────

  describe('safeSTT — Speech to Text', () => {
    let fetchSpy: any

    beforeEach(() => {
      fetchSpy = vi.fn()
      global.fetch = fetchSpy
    })

    it('[R1] Successful STT transcription', async () => {
      const mockResponse = { text: 'Hola, quiero agendar' }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const blob = new Blob(['audio data'], { type: 'audio/webm' })
      const result = await safeSTT(blob, 'test-key', 'es')

      expect(result.data).toEqual(mockResponse)
      expect(result.error).toBeUndefined()
      expect(result.retries).toBe(0)
      expect(result.modelUsed).toBe('whisper-large-v3-turbo')
    })

    it('[R2] STT API error → graceful failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      const blob = new Blob(['audio data'], { type: 'audio/webm' })
      const result = await safeSTT(blob, 'invalid-key', 'es')

      expect(result.data).toBeNull()
      expect(result.error).toBeDefined()
      expect(result.latency).toBeGreaterThanOrEqual(0)
    })

    it('[R3] STT circuit breaker tripped → fail fast', async () => {
      // Mock circuit breaker to return false
      const { aiCircuit } = await import('@/lib/ai/circuit-breaker')
      vi.mocked(aiCircuit.isAvailable).mockReturnValueOnce(false)

      const blob = new Blob(['audio data'], { type: 'audio/webm' })
      const result = await safeSTT(blob, 'test-key', 'es')

      expect(result.circuitTripped).toBe(true)
      expect(result.data).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // ── Tests: safeLLM ───────────────────────────────────────────────────────────

  describe('safeLLM — Language Model', () => {
    let fetchSpy: any

    beforeEach(() => {
      fetchSpy = vi.fn()
      global.fetch = fetchSpy
    })

    it('[R4] Successful LLM response with tools', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Perfecto, voy a agendar tu cita.' } }],
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const messages = [{ role: 'user', content: 'Hola' }]
      const tools = [{ name: 'confirm_booking' }]
      const result = await safeLLM(messages, tools, 'test-key', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile')

      expect(result.data).toEqual(mockResponse)
      expect(result.error).toBeUndefined()
      expect(result.modelUsed).toBe('llama-3.1-8b-instant')
    })

    it('[R5] LLM primary failure → fallback to secondary model', async () => {
      // First call (primary) fails, second call (fallback) succeeds
      const fallbackResponse = {
        choices: [{ message: { content: 'Usando modelo fallback' } }],
      }

      fetchSpy
        .mockResolvedValueOnce(new Response('Rate limit', { status: 429 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(fallbackResponse), { status: 200 })
        )

      const messages = [{ role: 'user', content: 'Hola' }]
      const tools = []
      const result = await safeLLM(messages, tools, 'test-key')

      expect(result.data).toEqual(fallbackResponse)
      expect(result.modelUsed).toBe('llama-3.3-70b-versatile')
    })

    it('[R6] All keys exhausted → return error', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      )

      const messages = [{ role: 'user', content: 'Hola' }]
      const tools = []
      const result = await safeLLM(messages, tools, 'bad-key')

      expect(result.data).toBeNull()
      expect(result.latency).toBeGreaterThanOrEqual(0)
    })

    it('[R7] LLM response metadata includes latency', async () => {
      const mockResponse = { choices: [] }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      )

      const messages = [{ role: 'user', content: 'Hola' }]
      const result = await safeLLM(messages, [], 'test-key')

      expect(result.latency).toBeGreaterThanOrEqual(0)
      expect(result.retries).toBe(0)
    })
  })

  // ── Tests: safeTTS ───────────────────────────────────────────────────────────

  describe('safeTTS — ElevenLabs Text to Speech', () => {
    let fetchSpy: any

    beforeEach(() => {
      fetchSpy = vi.fn()
      global.fetch = fetchSpy
    })

    it('[R8] Successful TTS synthesis', async () => {
      const audioBuffer = new ArrayBuffer(100)
      fetchSpy.mockResolvedValueOnce(
        new Response(audioBuffer, { status: 200 })
      )

      const result = await safeTTS('Hola', 'test-key', 'voice-1')

      expect(result.data?.audioUrl).toBeDefined()
      expect(result.data?.useNativeFallback).toBe(false)
      expect(result.latency).toBeGreaterThanOrEqual(0)
    })

    it('[R9] TTS API error → fallback to native browser TTS', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      const result = await safeTTS('Hola', 'test-key', 'voice-1')

      expect(result.data?.audioUrl).toBeNull()
      expect(result.data?.useNativeFallback).toBe(true)
    })

    it('[R10] Missing API key → graceful fallback', async () => {
      const result = await safeTTS('Hola', '', 'voice-1')

      expect(result.data?.useNativeFallback).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('[R11] TTS circuit tripped → fallback without call', async () => {
      const { aiCircuit } = await import('@/lib/ai/circuit-breaker')
      vi.mocked(aiCircuit.isAvailable).mockReturnValueOnce(false)

      const result = await safeTTS('Hola', 'test-key', 'voice-1')

      expect(result.circuitTripped).toBe(true)
      expect(result.data?.useNativeFallback).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // ── Tests: safeDeepgramTTS ───────────────────────────────────────────────────

  describe('safeDeepgramTTS — Deepgram Aura Text to Speech', () => {
    let fetchSpy: any

    beforeEach(() => {
      fetchSpy = vi.fn()
      global.fetch = fetchSpy
    })

    it('[R12] Successful Deepgram synthesis', async () => {
      const audioBuffer = new ArrayBuffer(100)
      fetchSpy.mockResolvedValueOnce(
        new Response(audioBuffer, { status: 200 })
      )

      const result = await safeDeepgramTTS('Hola', 'test-key', 'aura-2-nestor-es')

      expect(result.data?.audioUrl).toBeDefined()
      expect(result.data?.useNativeFallback).toBe(false)
      expect(result.modelUsed).toBe('aura-2-nestor-es')
    })

    it('[R13] Deepgram API error → fallback to native', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      const result = await safeDeepgramTTS('Hola', 'bad-key', 'aura-2-nestor-es')

      expect(result.data?.audioUrl).toBeNull()
      expect(result.data?.useNativeFallback).toBe(true)
    })

    it('[R14] Deepgram exception handling', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const result = await safeDeepgramTTS('Hola', 'test-key', 'aura-2-nestor-es')

      expect(result.data?.useNativeFallback).toBe(true)
      expect(result.latency).toBeGreaterThanOrEqual(0)
    })

    it('[R15] Deepgram with custom model', async () => {
      const audioBuffer = new ArrayBuffer(100)
      fetchSpy.mockResolvedValueOnce(
        new Response(audioBuffer, { status: 200 })
      )

      const result = await safeDeepgramTTS('Hola', 'test-key', 'aura-2-luna-es')

      expect(result.modelUsed).toBe('aura-2-luna-es')
    })
  })
})
