/**
 * winback-messenger.test.ts — adapter for the IRetentionMessenger port.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §7 (template client_winback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendReactivationMessage = vi.fn()
vi.mock('@/lib/services/whatsapp.service', () => ({
  sendReactivationMessage: (...args: unknown[]) => sendReactivationMessage(...args),
}))

import { WinbackMessenger, WINBACK_TEMPLATE } from '@/lib/services/winback-messenger'

beforeEach(() => vi.clearAllMocks())

describe('WinbackMessenger', () => {
  const params = { to: '+573210000001', clientName: 'Juan', businessName: 'Bella Salón' }

  it('sends with the approved client_winback template and maps success to ok', async () => {
    sendReactivationMessage.mockResolvedValueOnce({ success: true })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result.error).toBeNull()
    expect(WINBACK_TEMPLATE).toBe('client_winback')
    expect(sendReactivationMessage).toHaveBeenCalledWith({
      to: '+573210000001',
      clientName: 'Juan',
      businessName: 'Bella Salón',
      template: 'client_winback',
    })
  })

  it('maps a failed send to a fail Result (never throws)', async () => {
    sendReactivationMessage.mockResolvedValueOnce({ success: false, error: 'meta down' })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result.data).toBeNull()
    expect(result.error).toContain('meta down')
  })
})
