/**
 * AI Executor — Unit Tests
 *
 * Tests for lib/application/ai/executor.ts
 * Covers: role enforcement, error handling, multiple commands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock tool registry ──────────────────────────────────────────────────────
vi.mock('@/lib/ai/tool-registry', () => ({
  toolRegistry: {
    execute: vi.fn(),
  },
}))

// ── Mock rate limiter ───────────────────────────────────────────────────────
vi.mock('@/lib/api/rate-limit', () => ({
  WRITE_TOOLS: new Set(['book_appointment', 'cancel_appointment', 'update_appointment', 'register_payment', 'create_client', 'update_client', 'delete_client']),
  writeToolRateLimiter: {
    isRateLimited: vi.fn().mockReturnValue({ limited: false, retryAfter: 0 }),
  },
}))

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { executeCommands } from '@/lib/application/ai/executor'
import { toolRegistry } from '@/lib/ai/tool-registry'

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeCommand(toolName: string, args = {}): any {
  return { toolName, toolCallId: `call_${toolName}`, args }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AI Executor', () => {
  const mockExecute = toolRegistry.execute as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('executes a single READ tool successfully', async () => {
    mockExecute.mockResolvedValue('Listo: datos obtenidos.')

    const result = await executeCommands(
      [makeCommand('get_services')],
      'biz-123', 'user-456', 'America/Bogota', 'employee'
    )

    expect(result.toolMessages).toHaveLength(1)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.toolMessages[0]!.name).toBe('get_services')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.toolMessages[0]!.content).toBe('Listo: datos obtenidos.')
    expect(result.actionPerformed).toBe(true)
  })

  it('blocks employee from accessing OWNER_ONLY_TOOLS (revenue)', async () => {
    const result = await executeCommands(
      [makeCommand('get_revenue_stats')],
      'biz-123', 'user-456', 'America/Bogota', 'employee'
    )

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.toolMessages[0]!.content).toContain('exclusiva del propietario del negocio')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('allows owner to access OWNER_ONLY_TOOLS', async () => {
    mockExecute.mockResolvedValue('Revenue: $5000')

    const result = await executeCommands(
      [makeCommand('get_revenue_stats')],
      'biz-123', 'user-456', 'America/Bogota', 'owner'
    )

    expect(mockExecute).toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.toolMessages[0]!.content).toBe('Revenue: $5000')
  })

  it('executes multiple commands in sequence', async () => {
    mockExecute.mockResolvedValue('Done')

    const result = await executeCommands(
      [makeCommand('get_services'), makeCommand('get_clients')],
      'biz-123', 'user-456', 'America/Bogota'
    )

    expect(result.toolMessages).toHaveLength(2)
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('records traces for each command', async () => {
    mockExecute.mockResolvedValue('OK')

    const result = await executeCommands(
      [makeCommand('get_services')],
      'biz-123', 'user-456', 'America/Bogota'
    )

    expect(result.traces).toHaveLength(1)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.traces[0]!.toolName).toBe('get_services')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.traces[0]!.success).toBe(true)
  })
})
