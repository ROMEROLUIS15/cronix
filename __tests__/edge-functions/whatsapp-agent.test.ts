/**
 * WhatsApp Agent — Unit Tests for anti-hallucination gates.
 *
 * Covers the REAL production logic of two anti-hallucination layers:
 *   - confirmation-gate: the deterministic 2-turn gate that only lets booking
 *     tools become callable after a "¿Confirmo…?" + an affirmative reply.
 *   - tool-recovery: promoting leaked `<function>` text into a real tool_call
 *     (only valid booking tools with parseable JSON).
 *
 * (Both modules are pure — no Deno globals, no I/O — so they run under vitest.)
 */
import { describe, it, expect } from 'vitest'
import {
  isAffirmative,
  lastAssistantWasConfirmation,
  toolsAllowedThisTurn,
} from '../../supabase/functions/process-whatsapp/confirmation-gate'
import { recoverEmbeddedToolCall } from '../../supabase/functions/process-whatsapp/tool-recovery'

describe('confirmation-gate — isAffirmative', () => {
  it('accepts clear affirmatives', () => {
    for (const t of ['sí', 'si', 'dale', 'ok', 'claro', 'correcto', 'de acuerdo', 'confirmo']) {
      expect(isAffirmative(t)).toBe(true)
    }
  })

  it('rejects negatives even when they contain affirmative-ish words', () => {
    for (const t of ['no', 'todavía no', 'mejor no', 'aún no']) {
      expect(isAffirmative(t)).toBe(false)
    }
  })

  it('rejects empty input and over-long replies (not a one-word yes)', () => {
    expect(isAffirmative('')).toBe(false)
    expect(isAffirmative('a'.repeat(61))).toBe(false)
  })

  it('matches accent-ending affirmatives (regression: \\b fails after í/á)', () => {
    // Before the accent-safe boundary fix, "sí" / "ajá" / "así es" returned false
    // because \b does not see accented chars as word characters.
    expect(isAffirmative('sí')).toBe(true)
    expect(isAffirmative('ajá')).toBe(true)
    expect(isAffirmative('así es')).toBe(true)
  })

  it('still rejects words that merely start with an affirmative', () => {
    expect(isAffirmative('sinceramente lo dudo')).toBe(false) // "si…" prefix must not match
    expect(isAffirmative('claroscuro')).toBe(false)
  })
})

describe('confirmation-gate — lastAssistantWasConfirmation', () => {
  it('is true when the last assistant turn asked a confirmation question', () => {
    expect(lastAssistantWasConfirmation([
      { role: 'user', text: 'cancela mi cita' },
      { role: 'assistant', text: '¿Confirmo que cancele tu cita de Corte del 10 de junio?' },
    ])).toBe(true)
  })

  it('is false for a non-confirmation assistant turn', () => {
    expect(lastAssistantWasConfirmation([
      { role: 'assistant', text: 'Tu cita es el 10 de junio a las 3pm.' },
    ])).toBe(false)
  })

  it('is false for empty history', () => {
    expect(lastAssistantWasConfirmation([])).toBe(false)
  })
})

describe('confirmation-gate — toolsAllowedThisTurn (the gate)', () => {
  const confirmTurn = [{ role: 'assistant', text: '¿Confirmo tu cita?' }]

  it('opens tools only on confirmation + affirmative', () => {
    expect(toolsAllowedThisTurn(confirmTurn, 'sí')).toBe(true)
  })

  it('stays closed when the user declines', () => {
    expect(toolsAllowedThisTurn(confirmTurn, 'no')).toBe(false)
  })

  it('stays closed without a prior confirmation question', () => {
    expect(toolsAllowedThisTurn([{ role: 'assistant', text: 'Hola, ¿en qué ayudo?' }], 'sí')).toBe(false)
  })
})

describe('tool-recovery — recoverEmbeddedToolCall', () => {
  it('recovers a valid booking tool from <function=…> syntax', () => {
    const r = recoverEmbeddedToolCall('<function=confirm_booking>{"service_id":"s1","date":"2026-06-01","time":"15:00"}</function>')
    expect(r).toEqual({
      status: 'recovered',
      name: 'confirm_booking',
      argsRaw: '{"service_id":"s1","date":"2026-06-01","time":"15:00"}',
    })
  })

  it('recovers from the alternate <function>name</function>{json} form', () => {
    const r = recoverEmbeddedToolCall('<function>cancel_booking</function>{"appointment_id":"a1"}')
    expect(r?.status).toBe('recovered')
    expect(r && 'name' in r ? r.name : null).toBe('cancel_booking')
  })

  it('flags unknown tool names as invalid (do not execute)', () => {
    expect(recoverEmbeddedToolCall('<function=delete_everything>{}</function>'))
      .toEqual({ status: 'invalid', name: 'delete_everything' })
  })

  it('flags malformed JSON as invalid', () => {
    expect(recoverEmbeddedToolCall('<function=confirm_booking>{not valid json}</function>'))
      .toEqual({ status: 'invalid', name: 'confirm_booking' })
  })

  it('returns null when there is no embedded function', () => {
    expect(recoverEmbeddedToolCall('Claro, ¿para qué fecha te gustaría la cita?')).toBeNull()
  })
})
