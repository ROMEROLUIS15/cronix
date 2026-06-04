/**
 * final-response.test.ts — Characterization tests for selectFinalResponse.
 *
 * Pins the exact branch behavior of the final-pass decision tree so that
 * future refactors cannot silently change what WhatsApp customers receive.
 *
 * Branch map:
 *  A. actionPerformed + success=true  → renderBookingSuccessTemplate
 *  B. actionPerformed + success=false → deterministic error by errorCode
 *  C. !loopText (no action, empty)   → clarification fallback
 *  D. loopText present               → 8B conversational reply verbatim
 */

import { describe, it, expect } from 'vitest'
import { selectFinalResponse } from '../../final-response'

const TZ = 'America/Bogota'

// ── A. Tool succeeded ─────────────────────────────────────────────────────────

describe('A — tool succeeded → booking success template', () => {
  it('confirm_booking: returns full date+time template', () => {
    const result = selectFinalResponse(
      true,
      { success: true, date: '2026-06-10', time: '15:00', service_name: 'Corte de cabello' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('✅')
    expect(result).toContain('Corte de cabello')
    expect(result).toContain('3:00 pm')
  })

  it('reschedule_booking: returns reagendada template', () => {
    const result = selectFinalResponse(
      true,
      { success: true, new_date: '2026-07-01', new_time: '10:30', service_name: 'Manicura' },
      '',
      { tool: 'reschedule_booking' },
      TZ,
    )
    expect(result).toContain('✅')
    expect(result).toContain('reagendada')
    expect(result).toContain('Manicura')
    expect(result).toContain('10:30 am')
  })

  it('cancel_booking: returns cancelada template', () => {
    const result = selectFinalResponse(
      true,
      { success: true, date: '2026-06-15', time: '09:00', service_name: 'Pedicura' },
      '',
      { tool: 'cancel_booking' },
      TZ,
    )
    expect(result).toContain('❌')
    expect(result).toContain('cancelada')
    expect(result).toContain('Pedicura')
  })

  it('unknown tool: returns generic "Acción completada"', () => {
    const result = selectFinalResponse(
      true,
      { success: true },
      '',
      { tool: 'unknown_tool' },
      TZ,
    )
    expect(result).toBe('✅ Acción completada.')
  })

  it('missing lastTrace: falls back to empty tool name → generic template', () => {
    const result = selectFinalResponse(
      true,
      { success: true },
      '',
      undefined,
      TZ,
    )
    expect(result).toBe('✅ Acción completada.')
  })

  it('loopExhausted with success still returns template (not fallback)', () => {
    const result = selectFinalResponse(
      true,
      { success: true, date: '2026-06-10', time: '15:00', service_name: 'Depilación' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('Depilación')
  })
})

// ── B. Tool failed — deterministic error by errorCode ─────────────────────────

describe('B — tool failed → deterministic error message', () => {
  it('SLOT_CONFLICT → slot conflict message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'SLOT_CONFLICT: horario ocupado' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('horario ya está ocupado')
  })

  it('"Slot no disponible" → same slot conflict message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'Slot no disponible en esa hora' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('horario ya está ocupado')
  })

  it('BOOKING_RATE_LIMIT → rate limit message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'BOOKING_RATE_LIMIT exceeded' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('límite de citas')
  })

  it('INVALID_ARGS → invalid args message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'INVALID_ARGS: missing service_id' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('problema con los datos')
  })

  it('UNAUTHORIZED → not found message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'UNAUTHORIZED' },
      '',
      { tool: 'cancel_booking' },
      TZ,
    )
    expect(result).toContain('No encontré esa cita')
  })

  it('NOT_FOUND → not found message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'NOT_FOUND: appointment does not exist' },
      '',
      { tool: 'cancel_booking' },
      TZ,
    )
    expect(result).toContain('No encontré esa cita')
  })

  it('unknown error code → generic error message', () => {
    const result = selectFinalResponse(
      true,
      { success: false, error: 'TOOL_EXECUTION_ERROR: error interno' },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('No pude procesar')
  })

  it('null error field → generic error message', () => {
    const result = selectFinalResponse(
      true,
      { success: false },
      '',
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).toContain('No pude procesar')
  })
})

// ── C. No action, empty loopText → clarification fallback ────────────────────

describe('C — no action + empty loopText → clarification fallback', () => {
  it('returns clarification message when both actionPerformed=false and loopText=""', () => {
    const result = selectFinalResponse(false, null, '', undefined, TZ)
    expect(result).toContain('¿Podrías indicarme')
  })

  it('returns clarification message when loopText is empty string', () => {
    const result = selectFinalResponse(false, null, '', { tool: '' }, TZ)
    expect(result).toContain('¿Podrías indicarme')
  })
})

// ── D. 8B direct conversational reply ────────────────────────────────────────

describe('D — 8B produced text → return verbatim', () => {
  it('returns loopText unchanged when no action was performed', () => {
    const msg = 'Hola, ¿en qué te puedo ayudar hoy?'
    const result = selectFinalResponse(false, null, msg, undefined, TZ)
    expect(result).toBe(msg)
  })

  it('returns loopText even when actionPerformed is false and lastToolParsed is null', () => {
    const msg = 'Por supuesto, puedo ayudarte a agendar una cita.'
    const result = selectFinalResponse(false, null, msg, undefined, TZ)
    expect(result).toBe(msg)
  })

  it('does NOT return loopText when action succeeded (template wins)', () => {
    const loopText = 'Tu cita está lista'
    const result = selectFinalResponse(
      true,
      { success: true, date: '2026-06-10', time: '10:00', service_name: 'Masaje' },
      loopText,
      { tool: 'confirm_booking' },
      TZ,
    )
    expect(result).not.toBe(loopText)
    expect(result).toContain('✅')
  })
})
