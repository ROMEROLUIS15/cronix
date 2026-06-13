/**
 * nameMentionedInCorpus — token-boundary anti-hallucination guard.
 *
 * Regression suite for the two holes of the substring-based version:
 *   - "Ana" passed whenever the user said "mañana" (normalized "manana"
 *     contains "ana") → fabricated client names slipped through on most
 *     scheduling turns.
 *   - Names whose tokens were all <3 chars ("Lu") could NEVER pass, locking
 *     legitimate operations into a rejection loop.
 */

import { describe, it, expect } from 'vitest'
import { nameMentionedInCorpus } from '../conversation/slot-extractor.ts'

describe('nameMentionedInCorpus — token matching', () => {
  it('accepts a literal mention', () => {
    expect(nameMentionedInCorpus('agenda a Pedro para mañana', 'Pedro')).toBe(true)
  })

  it('accepts a partial first-name the user said (prefix ≥4)', () => {
    expect(nameMentionedInCorpus('busca a Mari por favor', 'María Pérez')).toBe(true)
  })

  it('accepts a phonetic STT variant (Lizet ↔ Lisset)', () => {
    expect(nameMentionedInCorpus('cancela la cita de Lizet', 'Lisset Gómez')).toBe(true)
  })

  it('accepts an all-short-tokens name said literally (old guard never could)', () => {
    expect(nameMentionedInCorpus('elimina a Lu', 'Lu')).toBe(true)
  })

  it('REJECTS "Ana" when the user only said "mañana" (the substring hole)', () => {
    expect(nameMentionedInCorpus('agenda un corte para mañana a las 3', 'Ana')).toBe(false)
  })

  it('REJECTS "Mar" when the user only said "martes"', () => {
    expect(nameMentionedInCorpus('qué citas tengo el martes', 'Mar')).toBe(false)
  })

  it('REJECTS a fully fabricated name', () => {
    expect(nameMentionedInCorpus('agenda a Pedro mañana a las 3', 'Valentina Ruiz')).toBe(false)
  })

  it('connector tokens never carry a match ("de" in service names)', () => {
    expect(nameMentionedInCorpus('la cita de Pedro', 'Corte de cabello')).toBe(false)
  })

  it('multi-token service matches via its meaningful token', () => {
    expect(nameMentionedInCorpus('un corte de cabello para Pedro', 'Corte de cabello')).toBe(true)
  })

  it('empty corpus or empty name → false (callers fail-open on empty corpus themselves)', () => {
    expect(nameMentionedInCorpus('', 'Pedro')).toBe(false)
    expect(nameMentionedInCorpus('agenda a Pedro', '')).toBe(false)
  })
})
