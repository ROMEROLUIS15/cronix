import { describe, it, expect } from 'vitest'
import { detectCancel } from '../fast-path.ts'

const TODAY = '2026-05-13'
const LAST_REF = { clientName: 'Gardi Suárez' }

describe('cancel fast path — anaphoric', () => {
  it('"cancélala" → uses lastRef', () => {
    const out = detectCancel('cancélala', TODAY, LAST_REF)
    expect(out?.client_name).toBe('Gardi Suárez')
  })
  it('"cancela esa cita" → uses lastRef', () => {
    const out = detectCancel('cancela esa cita', TODAY, LAST_REF)
    expect(out?.client_name).toBe('Gardi Suárez')
  })
  it('"sí, cancélala" → confirmation prefix accepted', () => {
    const out = detectCancel('sí, cancélala', TODAY, LAST_REF)
    expect(out?.client_name).toBe('Gardi Suárez')
  })
  it('anaphoric without lastRef → null', () => {
    expect(detectCancel('cancélala', TODAY, null)).toBeNull()
  })
})

describe('cancel fast path — explicit', () => {
  it('"cancela la cita de María" → captures name (accent-stripped)', () => {
    const out = detectCancel('cancela la cita de María', TODAY, null)
    expect(out?.client_name).toBe('maria')
  })
  it('"cancela la cita de Pedro Pérez del 21 de mayo" → captures name + date', () => {
    const out = detectCancel('cancela la cita de Pedro Pérez del 21 de mayo', TODAY, null)
    expect(out?.client_name).toBe('pedro perez')
    expect(out?.date).toBe('2026-05-21')
  })
  it('"cancela a Luis" — short form', () => {
    const out = detectCancel('cancela a Luis', TODAY, null)
    expect(out?.client_name).toBe('luis')
  })
})

describe('cancel fast path — non-matches', () => {
  it('"qué citas tengo" → null', () => {
    expect(detectCancel('qué citas tengo mañana', TODAY, null)).toBeNull()
  })
  it('"hola luis" → null', () => {
    expect(detectCancel('hola luis', TODAY, null)).toBeNull()
  })
})
