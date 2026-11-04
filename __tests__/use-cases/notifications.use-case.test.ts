/**
 * Notifications Use-Case — Unit Tests
 *
 * Tests for lib/use-cases/notifications.use-case.ts
 * Covers: appointment event notifications (created, confirmed, cancelled).
 */
import { describe, it, expect } from 'vitest'

import {
  notificationForAppointmentConfirmed,
} from '@/lib/use-cases/notifications.use-case'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Notifications Use-Case', () => {
  const BIZ = 'biz-123'
  const CLIENT = 'María García'
  const SERVICE = 'Corte de cabello'
  const TIME = '3:00 PM'

  describe('notificationForAppointmentConfirmed', () => {
    it('includes confirmation message', () => {
      const result = notificationForAppointmentConfirmed(BIZ, CLIENT, SERVICE, TIME)

      expect(result.title).toContain('confirmada')
      expect(result.content).toContain(CLIENT)
      expect(result.content).toContain(SERVICE)
    })

    it('uses success type', () => {
      const result = notificationForAppointmentConfirmed(BIZ, CLIENT, SERVICE, TIME)

      expect(result.type).toBe('success')
    })

    it('includes confirmed event in metadata', () => {
      const result = notificationForAppointmentConfirmed(BIZ, CLIENT, SERVICE, TIME)

      expect(result.metadata).toHaveProperty('event', 'appointment.confirmed')
    })
  })

})
