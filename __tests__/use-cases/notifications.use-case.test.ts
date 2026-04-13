/**
 * Notifications Use-Case — Unit Tests
 *
 * Tests for lib/use-cases/notifications.use-case.ts
 * Covers: appointment event notifications (created, confirmed, cancelled).
 */
import { describe, it, expect } from 'vitest'

import {
  notificationForAppointmentCreated,
  notificationForAppointmentConfirmed,
  notificationForAppointmentCancelled,
} from '@/lib/use-cases/notifications.use-case'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Notifications Use-Case', () => {
  const BIZ = 'biz-123'
  const CLIENT = 'María García'
  const SERVICE = 'Corte de cabello'
  const TIME = '3:00 PM'

  describe('notificationForAppointmentCreated', () => {
    it('creates notification with correct business_id', () => {
      const result = notificationForAppointmentCreated(BIZ, CLIENT, SERVICE, TIME)

      expect(result.business_id).toBe(BIZ)
    })

    it('includes client and service name in content', () => {
      const result = notificationForAppointmentCreated(BIZ, CLIENT, SERVICE, TIME)

      expect(result.content).toContain(CLIENT)
      expect(result.content).toContain(SERVICE)
      expect(result.content).toContain(TIME)
    })

    it('uses success type', () => {
      const result = notificationForAppointmentCreated(BIZ, CLIENT, SERVICE, TIME)

      expect(result.type).toBe('success')
    })

    it('includes metadata with event type', () => {
      const result = notificationForAppointmentCreated(BIZ, CLIENT, SERVICE, TIME)

      expect(result.metadata).toEqual({
        event: 'appointment.created',
        clientName: CLIENT,
        serviceName: SERVICE,
      })
    })
  })

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

  describe('notificationForAppointmentCancelled', () => {
    it('includes cancellation message', () => {
      const result = notificationForAppointmentCancelled(BIZ, CLIENT, SERVICE)

      expect(result.title).toContain('cancelada')
      expect(result.content).toContain(CLIENT)
      expect(result.content).toContain(SERVICE)
    })

    it('includes reason when provided', () => {
      const result = notificationForAppointmentCancelled(BIZ, CLIENT, SERVICE, 'Cliente enfermó')

      expect(result.content).toContain('Cliente enfermó')
    })

    it('omits reason when not provided', () => {
      const result = notificationForAppointmentCancelled(BIZ, CLIENT, SERVICE)

      expect(result.content).not.toContain('—')
    })
  })
})
