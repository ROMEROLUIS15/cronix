/**
 * booking-adapter.test.ts — Regression for service_id resolution.
 *
 * BUG (prod, 2026-06-18): the 8B agent copied the example UUID hardcoded in the
 * system prompt into confirm_booking's service_id. The adapter trusted any
 * UUID-shaped string and passed it straight to fn_book_appointment_wa, which
 * raised appointments_service_id_fkey → DB_ERROR on every such booking.
 *
 * Invariant (modulo-whatsapp-citas §2): service_id MUST resolve to an entry in
 * the loaded catalog (p.services). A UUID-shaped id that is NOT in the catalog
 * must be rejected as INVALID_ARGS BEFORE any RPC call — never reach the DB.
 */

import { describe, it, expect } from 'vitest'
import { WhatsAppBookingAdapter } from '../booking-adapter.ts'

const SERVICES = [
  { id: '4c7b4112-2890-494d-9891-eb07904d6628', name: 'Tarjeta', duration_min: 30, price: 50 },
]

const base = {
  businessId:  '104a59e2-d8d6-46f0-a94a-716bf07d0fce',
  timezone:    'America/Bogota',
  senderPhone: '573001112233',
  services:    SERVICES,
  activeAppts: [],
}

function makeAdapter() {
  // The early rejection path returns before any network call, so a dummy client
  // is enough — createClient does not connect until a query is issued.
  return new WhatsAppBookingAdapter('https://example.supabase.co', 'service-role-key')
}

describe('WhatsAppBookingAdapter.confirmBooking — service_id resolution', () => {
  it('rejects a UUID-shaped service_id that is not in the catalog (no RPC, no FK crash)', async () => {
    const adapter = makeAdapter()
    const result = await adapter.execute({
      toolName: 'confirm_booking',
      rawArgs: {
        // The exact example UUID the prompt used to hardcode — alien to the catalog.
        service_id: '339afed4-cbc2-423b-9d8c-17a6f52fb642',
        date: '2026-06-19',
        time: '13:00',
      },
      ...base,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('INVALID_ARGS')
      expect(result.message).toContain('Tarjeta')
    }
  })

  it('resolves a service named (not UUID) against the catalog', async () => {
    const adapter = makeAdapter()
    // We cannot reach a real DB here, but a bare service name must NOT be rejected
    // at the resolution stage — it should resolve to the catalog id and proceed
    // past validation (failing later only at the network boundary).
    const result = await adapter.execute({
      toolName: 'confirm_booking',
      rawArgs: { service_id: 'Tarjeta', date: '2026-06-19', time: '13:00' },
      ...base,
    })
    // Either DB_ERROR (network) or success — but NEVER INVALID_ARGS for a known name.
    if (!result.success) {
      expect(result.error).not.toBe('INVALID_ARGS')
    }
  })

  it('rejects an empty service_id', async () => {
    const adapter = makeAdapter()
    const result = await adapter.execute({
      toolName: 'confirm_booking',
      rawArgs: { service_id: '', date: '2026-06-19', time: '13:00' },
      ...base,
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe('INVALID_ARGS')
  })
})
