/**
 * winback-messenger.test.ts — adapter for the IRetentionMessenger port.
 *
 * Spec: docs/specs/modulo-retencion/manifest.md §7 (template client_winback)
 * and the send-failure contract (platform-wide vs recipient-only failures).
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

    expect(result).toEqual({ ok: true })
    expect(WINBACK_TEMPLATE).toBe('client_winback')
    expect(sendReactivationMessage).toHaveBeenCalledWith({
      to: '+573210000001',
      clientName: 'Juan',
      businessName: 'Bella Salón',
      template: 'client_winback',
    })
  })

  it('maps a template-level Meta error to a platform failure carrying code and template', async () => {
    sendReactivationMessage.mockResolvedValueOnce({
      success: false,
      error: '(#132001) Template name does not exist in the translation',
      errorCode: 132001,
    })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result).toEqual({
      ok: false,
      failure: {
        scope: 'platform',
        code: 132001,
        template: 'client_winback',
        message: '(#132001) Template name does not exist in the translation',
      },
    })
  })

  it('maps a recipient-level Meta error to a recipient failure', async () => {
    sendReactivationMessage.mockResolvedValueOnce({
      success: false,
      error: 'not delivered to maintain healthy ecosystem engagement',
      errorCode: 131049,
    })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result).toMatchObject({ ok: false, failure: { scope: 'recipient', code: 131049 } })
  })

  it('maps a failure without a code to a recipient failure (never throws)', async () => {
    sendReactivationMessage.mockResolvedValueOnce({ success: false, error: 'meta down' })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result).toEqual({
      ok: false,
      failure: { scope: 'recipient', code: null, template: 'client_winback', message: 'meta down' },
    })
  })

  it('falls back to a default message when the failure carries none', async () => {
    sendReactivationMessage.mockResolvedValueOnce({ success: false })

    const result = await new WinbackMessenger().sendWinback(params)

    expect(result).toMatchObject({
      ok: false,
      failure: { message: 'No se pudo enviar la plantilla de reenganche.' },
    })
  })
})
