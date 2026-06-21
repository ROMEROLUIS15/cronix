/**
 * prompt-builder.test.ts — system prompt guards (anti-hallucination of business facts).
 */

import { describe, it, expect } from 'vitest'
import { buildMinimalSystemPrompt } from '../prompt-builder.ts'
import type { BusinessRagContext } from '../types.ts'

function ctx(address: string | null): BusinessRagContext {
  return {
    business: { id: 'b1', name: 'IGM', timezone: 'America/Caracas', phone: null, address, slug: 'igm',
      settings: {} as BusinessRagContext['business']['settings'] },
    services: [{ id: 's1', name: 'Tarjeta', duration_min: 30, price: 45 }],
    client: null, activeAppointments: [], history: [], bookedSlots: [],
  }
}

describe('buildMinimalSystemPrompt — business-facts anti-hallucination', () => {
  it('forbids inventing business data and tells the model to defer', () => {
    const p = buildMinimalSystemPrompt(ctx(null), 'Luis')
    expect(p).toMatch(/NUNCA INVENTES/i)
    expect(p).toMatch(/estacionamiento|m[ée]todos de pago|promociones/i)
    expect(p).toMatch(/confirmarlo directamente con el negocio/i)
  })

  it('injects the REAL address when present (so location answers use real data)', () => {
    const p = buildMinimalSystemPrompt(ctx('Av. Bolívar, local 5'), 'Luis')
    expect(p).toMatch(/Dirección del negocio: Av\. Bolívar, local 5/)
  })

  it('does not fabricate an address line when there is none', () => {
    const p = buildMinimalSystemPrompt(ctx(null), 'Luis')
    expect(p).not.toMatch(/Dirección del negocio:/)
  })
})
