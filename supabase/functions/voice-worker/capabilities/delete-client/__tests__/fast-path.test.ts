import { describe, it, expect } from 'vitest'
import { detectDeleteClient, extractRecentClientNameFromHistory } from '../fast-path.ts'
import type { SessionMessage } from '../../../core/session.ts'

const DUP_PROMPT_HISTORY: SessionMessage[] = [
  { role: 'user',      content: 'busca a luis romero' },
  { role: 'assistant', content: 'Tengo 2 clientes llamados Luis Romero con el mismo teléfono 04141234567 — parecen duplicados. ¿Elimino uno y dejo el otro?' },
]

const DIFFERENT_PHONES_HISTORY: SessionMessage[] = [
  { role: 'user',      content: 'busca a maria' },
  { role: 'assistant', content: 'Hay varios clientes llamados María: María Pérez con teléfono 04141111111, María López con teléfono 04149999999. ¿Cuál elimino, dime el teléfono?' },
]

const SEARCH_FOUND_HISTORY: SessionMessage[] = [
  { role: 'user',      content: 'tengo a Ana López' },
  { role: 'assistant', content: 'Sí, Ana López está entre tus clientes, su teléfono es 04143334444.' },
]

const NOISE_HISTORY: SessionMessage[] = [
  { role: 'user',      content: 'qué citas tengo mañana' },
  { role: 'assistant', content: 'No hay citas para el 14 de mayo.' },
]

describe('detectDeleteClient — (A) explicit + phone', () => {
  it('"elimina a Luis con teléfono 04141234567"', () => {
    const out = detectDeleteClient('elimina a Luis con teléfono 04141234567', [])
    expect(out).toEqual({ client_name: 'luis', phone: '04141234567' })
  })
  it('"borra a María del teléfono 0412 555 6677"', () => {
    const out = detectDeleteClient('borra a María del teléfono 0412 555 6677', [])
    expect(out?.client_name).toBe('maría')
    expect(out?.phone).toBe('0412 555 6677')
  })
  it('"quita a Pedro Pérez que tiene el teléfono +584141234567"', () => {
    const out = detectDeleteClient('quita a Pedro Pérez que tiene el teléfono +584141234567', [])
    expect(out?.client_name).toBe('pedro pérez')
    expect(out?.phone).toBe('+584141234567')
  })
  it('"elimina a la cliente Ana con el teléfono 04141234567"', () => {
    const out = detectDeleteClient('elimina a la cliente Ana con el teléfono 04141234567', [])
    expect(out?.client_name).toBe('ana')
    expect(out?.phone).toBe('04141234567')
  })
})

describe('detectDeleteClient — (B) explicit + any_duplicate', () => {
  it('"elimina a Luis cualquiera"', () => {
    const out = detectDeleteClient('elimina a Luis cualquiera', [])
    expect(out).toEqual({ client_name: 'luis', any_duplicate: true })
  })
  it('"elimina a Luis cualquiera de los dos"', () => {
    const out = detectDeleteClient('elimina a Luis cualquiera de los dos', [])
    expect(out?.client_name).toBe('luis')
    expect(out?.any_duplicate).toBe(true)
  })
  it('"borra a María alguno"', () => {
    const out = detectDeleteClient('borra a María alguno', [])
    expect(out?.client_name).toBe('maría')
    expect(out?.any_duplicate).toBe(true)
  })
  it('"borra a Luis los duplicados"', () => {
    const out = detectDeleteClient('borra a Luis los duplicados', [])
    expect(out?.client_name).toBe('luis')
    expect(out?.any_duplicate).toBe(true)
  })
  it('"elimina a Ana el duplicado"', () => {
    const out = detectDeleteClient('elimina a Ana el duplicado', [])
    expect(out?.client_name).toBe('ana')
    expect(out?.any_duplicate).toBe(true)
  })
})

describe('detectDeleteClient — (C) anaphoric verb (pulls name from history)', () => {
  it('"borra al duplicado" → uses last-mentioned client', () => {
    const out = detectDeleteClient('borra al duplicado', DUP_PROMPT_HISTORY)
    expect(out).toEqual({ client_name: 'Luis Romero', any_duplicate: true })
  })
  it('"elimina los duplicados"', () => {
    const out = detectDeleteClient('elimina los duplicados', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
    expect(out?.any_duplicate).toBe(true)
  })
  it('"borra uno"', () => {
    const out = detectDeleteClient('borra uno', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"borra al otro"', () => {
    const out = detectDeleteClient('borra al otro', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"sí, borra uno" — confirmation prefix allowed', () => {
    const out = detectDeleteClient('sí, borra uno', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"borra cualquiera"', () => {
    const out = detectDeleteClient('borra cualquiera', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"elimina el primero"', () => {
    const out = detectDeleteClient('elimina el primero', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  // Regression: "elimina AL primero" (a+el contraction) used to miss the
  // alternation and bounce to the LLM, which then asked search_clients
  // again and answered "no tengo a luis romero entre tus clientes".
  it('"elimina al primero" (a+el contraction)', () => {
    const out = detectDeleteClient('elimina al primero', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
    expect(out?.any_duplicate).toBe(true)
  })
  it('"elimina a la primera"', () => {
    const out = detectDeleteClient('elimina a la primera', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"elimina al segundo"', () => {
    const out = detectDeleteClient('elimina al segundo', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"borra al otro"', () => {
    const out = detectDeleteClient('borra al otro', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"elimina primero" (bare ordinal)', () => {
    const out = detectDeleteClient('elimina primero', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  // Anaphora must also resolve after a search-clients ambiguity ("Tengo N
  // clientes con nombre similar a X. ... ¿A cuál te refieres?"), not just
  // after the explicit deletion-prompt.
  it('"elimina al primero" after search-clients ambiguity', () => {
    const SEARCH_AMBIG_HISTORY: SessionMessage[] = [
      { role: 'user',      content: 'tengo a luis romero entre mis clientes?' },
      { role: 'assistant', content: 'Tengo 2 clientes con nombre similar a luis romero. Luis Romero, teléfono 04141234567. Luis Romero, teléfono 04249876543. ¿A cuál te refieres?' },
    ]
    const out = detectDeleteClient('elimina al primero', SEARCH_AMBIG_HISTORY)
    expect(out?.client_name).toBe('luis romero')
    expect(out?.any_duplicate).toBe(true)
  })
  it('anaphoric verb without resolvable history → null', () => {
    expect(detectDeleteClient('borra al duplicado', NOISE_HISTORY)).toBeNull()
  })
})

describe('detectDeleteClient — (D) confirmation-only reply (no verb)', () => {
  it('"sí" after deletion prompt → uses last-mentioned client', () => {
    const out = detectDeleteClient('sí', DUP_PROMPT_HISTORY)
    expect(out).toEqual({ client_name: 'Luis Romero', any_duplicate: true })
  })
  it('"sí, hazlo" → consent', () => {
    const out = detectDeleteClient('sí, hazlo', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"sí por favor" → consent', () => {
    const out = detectDeleteClient('sí por favor', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"claro" → consent', () => {
    const out = detectDeleteClient('claro', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"dale" → consent', () => {
    const out = detectDeleteClient('dale', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"ok" → consent', () => {
    const out = detectDeleteClient('ok', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"adelante" → consent', () => {
    const out = detectDeleteClient('adelante', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"el primero" → consent', () => {
    const out = detectDeleteClient('el primero', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"la primera" → consent', () => {
    const out = detectDeleteClient('la primera', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"el otro" → consent', () => {
    const out = detectDeleteClient('el otro', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"cualquiera" → consent', () => {
    const out = detectDeleteClient('cualquiera', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"el que quieras" → consent', () => {
    const out = detectDeleteClient('el que quieras', DUP_PROMPT_HISTORY)
    expect(out?.client_name).toBe('Luis Romero')
  })
  it('"el de teléfono 04141111111" — different-phones history', () => {
    const out = detectDeleteClient('el de teléfono 04141111111', DIFFERENT_PHONES_HISTORY)
    expect(out).toEqual({ client_name: 'María', phone: '04141111111' })
  })
  it('"el del teléfono 0412 555 6677" — variant article + phone', () => {
    const out = detectDeleteClient('el del teléfono 0412 555 6677', DIFFERENT_PHONES_HISTORY)
    expect(out?.phone).toBe('0412 555 6677')
  })
})

describe('detectDeleteClient — guard against false positives', () => {
  it('"sí" without a deletion prompt in history → null', () => {
    expect(detectDeleteClient('sí', SEARCH_FOUND_HISTORY)).toBeNull()
  })
  it('"sí" with empty history → null', () => {
    expect(detectDeleteClient('sí', [])).toBeNull()
  })
  it('"sí" after unrelated listing → null', () => {
    expect(detectDeleteClient('sí', NOISE_HISTORY)).toBeNull()
  })
  it('"hola, sí, eliminar el duplicado de Luis Romero por favor" — sentence too long for shape D, but matches B/A?', () => {
    // None of the shapes match (no clean explicit form), so this falls
    // through to the LLM. We assert null rather than a guess.
    expect(detectDeleteClient('hola, sí, eliminar el duplicado de Luis Romero por favor', DUP_PROMPT_HISTORY)).toBeNull()
  })
  it('"agenda a Luis para corte mañana a las 3" → null (different intent)', () => {
    expect(detectDeleteClient('agenda a Luis para corte mañana a las 3', DUP_PROMPT_HISTORY)).toBeNull()
  })
  it('"qué citas tengo mañana" → null', () => {
    expect(detectDeleteClient('qué citas tengo mañana', DUP_PROMPT_HISTORY)).toBeNull()
  })
})

describe('extractRecentClientNameFromHistory', () => {
  it('pulls name from "Tengo N clientes llamados X..."', () => {
    expect(extractRecentClientNameFromHistory(DUP_PROMPT_HISTORY)).toBe('Luis Romero')
  })
  it('pulls name from "Hay varios clientes llamados X..."', () => {
    expect(extractRecentClientNameFromHistory(DIFFERENT_PHONES_HISTORY)).toBe('María')
  })
  it('pulls name from "Sí, X está entre tus clientes..."', () => {
    expect(extractRecentClientNameFromHistory(SEARCH_FOUND_HISTORY)).toBe('Ana López')
  })
  it('returns null when no matching history', () => {
    expect(extractRecentClientNameFromHistory(NOISE_HISTORY)).toBeNull()
  })
  it('returns null on empty history', () => {
    expect(extractRecentClientNameFromHistory([])).toBeNull()
  })
})
