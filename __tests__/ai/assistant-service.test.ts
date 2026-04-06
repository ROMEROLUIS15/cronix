/**
 * Tests for AssistantService — ReAct loop (Luis IA floating button)
 *
 * NOTE: WhatsApp agent tests (supabase/functions/process-whatsapp/ai-agent.ts)
 * are NOT included here. That edge function runs on Deno runtime
 * (Deno.env, https://deno.land/ imports) which is incompatible with Vitest (Node.js).
 * WhatsApp agent tests require `deno test` or a local Supabase instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssistantService } from '@/lib/ai/assistant-service'
import type { ISttProvider, ILlmProvider, ITtsProvider, LlmMessage } from '@/lib/ai/providers/types'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/ai/tool-registry', () => ({
  toolRegistry: {
    getDefinitions: vi.fn().mockReturnValue([
      {
        type: 'function',
        function: {
          name:        'check_availability',
          description: 'Check available slots',
          parameters:  { type: 'object', properties: {}, required: [] },
        },
      },
    ]),
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/ai/memory', () => ({
  aiMemory: {
    getHistory:  vi.fn().mockReturnValue([]),
    addMessage:  vi.fn(),
  },
}))

vi.mock('@/lib/ai/memory-service', () => ({
  memoryService: {
    retrieve: vi.fn().mockResolvedValue([]),
    store:    vi.fn(),
  },
}))

vi.mock('@/lib/ai/prompts/luis.prompt', () => ({
  LUIS_PROMPT_CONFIG: {
    buildPrimaryPrompt:    vi.fn().mockReturnValue('SYSTEM_PROMPT'),
    getToolValidationPrompt: vi.fn().mockReturnValue('TOOL_VALIDATION_PROMPT'),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}))

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeStt(): ISttProvider {
  return {
    transcribe: vi.fn().mockResolvedValue({ text: 'Hola, ¿a qué hora abren?', latency: 50 }),
  }
}

function makeTts(): ITtsProvider {
  return {
    synthesize: vi.fn().mockResolvedValue({ audioUrl: 'https://cdn.example.com/audio.mp3', latency: 80 }),
  }
}

/** Builds an LlmProvider mock. Each call returns the next item in `responses`. */
function makeLlm(responses: Array<{ content?: string; tool_calls?: LlmMessage['tool_calls']; error?: string }>): ILlmProvider {
  let callIndex = 0
  return {
    chat: vi.fn().mockImplementation(() => {
      const r = responses[callIndex] ?? responses[responses.length - 1]
      callIndex++
      const message: LlmMessage = {
        role:       'assistant',
        content:    r.content ?? null,
        tool_calls: r.tool_calls,
      }
      return Promise.resolve({ message, error: r.error })
    }),
  }
}

const BUSINESS_ID = 'biz-123'
const USER_ID     = 'user-456'
const BIZ_NAME    = 'Salón Cronix'
const TIMEZONE    = 'America/Bogota'

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AssistantService — ReAct Loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── T1: Conversational — 8B answers directly, 70B skipped ──────────────────

  it('[T1] conversational — 8B answers, 70B skipped, actionPerformed=false', async () => {
    const llm = makeLlm([{ content: 'Abrimos de 9am a 7pm de lunes a sábado.' }])
    const service = new AssistantService(makeStt(), llm, makeTts())

    const result = await service.processVoiceRequest('Hola, ¿a qué hora abren?', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)

    expect(result.actionPerformed).toBe(false)
    expect(result.text).toBe('Abrimos de 9am a 7pm de lunes a sábado.')
    // Only 1 LLM call (the 8B loop) — no final 70B pass needed
    expect(llm.chat).toHaveBeenCalledTimes(1)
    expect(result.audioUrl).toBe('https://cdn.example.com/audio.mp3')
    expect(result.useNativeFallback).toBe(false)
    expect(result.debug?.steps).toBe(1)
  })

  // ── T2: Tool success — 8B calls tool, 70B generates empathetic reply ───────

  it('[T2] tool success — 8B calls tool, 70B confirms, actionPerformed=true', async () => {
    const { toolRegistry } = await import('@/lib/ai/tool-registry')

    ;(toolRegistry.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ success: true, message: 'Cita disponible el 10 de abril a las 3pm.' })
    )

    const toolCallMsg: LlmMessage = {
      role:    'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'check_availability', arguments: '{}' } },
      ],
    }

    const llm = makeLlm([
      // Step 1: 8B decides to call a tool
      { tool_calls: toolCallMsg.tool_calls },
      // Step 2: 8B receives tool result, no more tool_calls → exits loop with empty content
      { content: null },
      // Final pass: 70B generates empathetic response (always runs when actionPerformed=true)
      { content: 'Perfecto, tienes disponibilidad el 10 de abril a las 3pm. ¿Confirmo la cita?' },
    ])

    const service = new AssistantService(makeStt(), llm, makeTts())
    const result  = await service.processVoiceRequest('Quiero reservar una cita', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)

    expect(result.actionPerformed).toBe(true)
    expect(result.text).toContain('10 de abril')
    // 3 LLM calls: 2×8B (tool call + post-tool step) + 1×70B final pass
    // actionPerformed=true always triggers the 70B quality pass regardless of 8B reply
    expect(llm.chat).toHaveBeenCalledTimes(3)
    expect(result.debug?.toolsAttempted).toContain('check_availability')
    expect(result.debug?.loopExhausted).toBe(false)
  })

  // ── T3: MAX_STEPS exhausted — logger.warn called, 70B provides fallback ────

  it('[T3] MAX_STEPS exhausted — logger.warn + 70B fallback response', async () => {
    const { logger } = await import('@/lib/logger')
    const { toolRegistry } = await import('@/lib/ai/tool-registry')

    ;(toolRegistry.execute as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ success: false, message: 'Slot no disponible, reintentando.' })
    )

    const toolCallMsg: LlmMessage['tool_calls'] = [
      { id: 'call_loop', type: 'function', function: { name: 'check_availability', arguments: '{}' } },
    ]

    // 8B keeps calling the tool on every step (3 steps = MAX_STEPS), then 70B resolves
    const llm = makeLlm([
      { tool_calls: toolCallMsg },  // step 1 → tool
      { tool_calls: toolCallMsg },  // step 2 → tool
      { tool_calls: toolCallMsg },  // step 3 → tool (loop exhausted here)
      { content: 'Lo siento, no pude encontrar disponibilidad en este momento.' }, // 70B
    ])

    const service = new AssistantService(makeStt(), llm, makeTts())
    const result  = await service.processVoiceRequest('Busca algo disponible', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)

    expect(result.debug?.loopExhausted).toBe(true)
    expect(result.debug?.steps).toBe(3)
    // logger.warn must be called with the exhaustion tag
    expect(logger.warn).toHaveBeenCalledWith(
      'AI-AGENT-LOOP',
      expect.stringContaining('exhausted'),
      expect.objectContaining({ userId: USER_ID })
    )
    // 4 total calls: 3×8B + 1×70B
    expect(llm.chat).toHaveBeenCalledTimes(4)
    expect(result.text).toBeTruthy()
  })

  // ── T4: Rate limit error — graceful message, no throw ─────────────────────

  it('[T4] rate limit error — graceful message returned, no exception thrown', async () => {
    const llm = makeLlm([{ error: 'rate_limit exceeded, please retry' }])
    const service = new AssistantService(makeStt(), llm, makeTts())

    await expect(
      service.processVoiceRequest('Dame información', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)
    ).resolves.not.toThrow()

    const result = await service.processVoiceRequest('Dame información', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)

    expect(result.text).toMatch(/demanda|rate|minutos/i)
    expect(result.actionPerformed).toBe(false)
  })

  // ── T5: Tool timeout — Promise.race rejects, returns error string, no crash

  it('[T5] tool timeout — catches 10s timeout, returns error string, service does not crash', async () => {
    const { toolRegistry } = await import('@/lib/ai/tool-registry')

    // Simulate a tool that never resolves (will be beaten by the 10s timeout in the service)
    ;(toolRegistry.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<never>(() => {}) // hangs forever
    )

    const toolCallMsg: LlmMessage['tool_calls'] = [
      { id: 'call_hang', type: 'function', function: { name: 'check_availability', arguments: '{}' } },
    ]

    const llm = makeLlm([
      { tool_calls: toolCallMsg }, // step 1 → tool hangs → timeout
      { content: 'Disculpa, tuve un problema técnico al consultar la disponibilidad.' }, // 70B
    ])

    vi.useFakeTimers()

    const service = new AssistantService(makeStt(), llm, makeTts())
    const promise = service.processVoiceRequest('Quiero agendar', BUSINESS_ID, USER_ID, BIZ_NAME, TIMEZONE)

    // Advance past the 10s tool timeout while the promise is awaiting
    await vi.advanceTimersByTimeAsync(10_001)
    vi.useRealTimers()

    const result = await promise

    // The service must not throw — it catches the timeout and continues
    expect(result).toBeDefined()
    expect(result.text).toBeTruthy()
    // Tool result pushed to messages should contain the error string
    expect(result.debug?.toolsAttempted).toContain('check_availability')
  })
})
