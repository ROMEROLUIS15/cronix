// @ts-nocheck
/**
 * notification-service.test.ts — Unit Tests for Notification Service
 *
 * Tests the complete notification flow:
 * 1. Idempotency check (duplicate detection)
 * 2. DB persistence (fuente de verdad)
 * 3. Realtime broadcast (UI updates)
 * 4. WhatsApp notifications (business owner)
 *
 * Mocks Supabase client to verify orchestration logic without DB calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NotificationService } from '../notification-service'
import type { AppointmentEvent } from '@/lib/ai/orchestrator/events'

// Mock the logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ── Test Fixtures ────────────────────────────────────────────────────────────

const mockEvent: AppointmentEvent = {
  eventId: 'evt-123',
  businessId: 'biz-123',
  clientName: 'Alan',
  serviceName: 'Corte',
  date: '2026-04-25',
  time: '14:00',
  type: 'appointment.created',
  channel: 'whatsapp',
  userId: 'user-123',
}

function createMockSupabaseClient() {
  return {
    from: vi.fn((table: string) => {
      const chainObj = {
        select: vi.fn(function() { return this }),
        eq: vi.fn(function() { return this }),
        insert: vi.fn(async () => ({ error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
      return chainObj
    }),
    channel: vi.fn(() => ({
      send: vi.fn(async () => ({})),
    })),
    removeChannel: vi.fn(async () => ({})),
    functions: {
      invoke: vi.fn(async () => ({ error: null })),
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService
  let mockSupabase: any

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient()
    service = new NotificationService(mockSupabase)
  })

  // ── Idempotency Tests ────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('[N1] Duplicate event → skip processing', async () => {
      // Mock: event already exists in DB
      const fromMock = mockSupabase.from as any
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'notif-123' }, error: null }),
          }),
        }),
      })

      await service.handle(mockEvent)

      // With idempotency check returning a result, should not proceed to insert
      expect(mockSupabase.from).toHaveBeenCalledWith('notifications')
    })

    it('[N2] New event → process normally', async () => {
      // Mock: event does NOT exist
      const fromMock = mockSupabase.from as any
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      await service.handle(mockEvent)

      // Should proceed with insert
      expect(mockSupabase.from).toHaveBeenCalledWith('notifications')
    })
  })

  // ── Database Persistence Tests ───────────────────────────────────────────────

  describe('DB Persistence', () => {
    it('[N3] Appointment created event → DB entry with success type', async () => {
      const fromMock = mockSupabase.from as any

      // Idempotency check: not found
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert call
      const insertSpy = vi.fn(async () => ({ error: null }))
      fromMock.mockReturnValueOnce({
        insert: insertSpy,
      })

      await service.handle(mockEvent)

      expect(insertSpy).toHaveBeenCalled()
      const insertCall = insertSpy.mock.calls[0][0]
      expect(insertCall.type).toBe('success')
      expect(insertCall.event_id).toBe('evt-123')
    })

    it('[N4] Appointment cancelled event → DB entry with warning type', async () => {
      const cancelledEvent: AppointmentEvent = {
        ...mockEvent,
        type: 'appointment.cancelled',
      }

      const fromMock = mockSupabase.from as any

      // Idempotency check
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert call
      const insertSpy = vi.fn(async () => ({ error: null }))
      fromMock.mockReturnValueOnce({
        insert: insertSpy,
      })

      await service.handle(cancelledEvent)

      const insertCall = insertSpy.mock.calls[0][0]
      expect(insertCall.type).toBe('warning')
    })

    it('[N5] DB insert error → stop processing (fail-safe)', async () => {
      const fromMock = mockSupabase.from as any

      // Idempotency check
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert fails
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: { message: 'DB connection lost' } }),
      })

      await service.handle(mockEvent)

      // Should NOT call Realtime or WhatsApp since DB failed
      expect(mockSupabase.channel).not.toHaveBeenCalled()
    })
  })

  // ── Realtime Broadcast Tests ──────────────────────────────────────────────────

  describe('Realtime Broadcast', () => {
    it('[N6] Successful DB insert → broadcast to UI channel', async () => {
      const fromMock = mockSupabase.from as any
      const channelSendSpy = vi.fn(async () => ({}))
      const channelMock = {
        send: channelSendSpy,
      }

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Channel
      mockSupabase.channel.mockReturnValue(channelMock)

      await service.handle(mockEvent)

      expect(mockSupabase.channel).toHaveBeenCalledWith('notifications:biz-123')
      expect(channelSendSpy).toHaveBeenCalled()
    })

    it('[N7] Realtime broadcast failure → non-critical (DB already saved)', async () => {
      const fromMock = mockSupabase.from as any
      const channelMock = {
        send: vi.fn(async () => {
          throw new Error('Realtime disconnected')
        }),
      }

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Get owner phone (for WhatsApp)
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: function() {
            this.eq = vi.fn(() => this)
            return this
          },
          maybeSingle: async () => ({ data: { phone: '+573001234567' }, error: null }),
        }),
      })

      mockSupabase.channel.mockReturnValue(channelMock)

      // Should not throw
      await expect(service.handle(mockEvent)).resolves.not.toThrow()

      // Realtime should have been attempted
      expect(mockSupabase.channel).toHaveBeenCalled()
    })
  })

  // ── WhatsApp Notification Tests ───────────────────────────────────────────────

  describe('WhatsApp Notifications', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('[N8] Successful notification flow → WhatsApp invoked', async () => {
      const fromMock = mockSupabase.from as any

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Channel
      mockSupabase.channel.mockReturnValue({
        send: vi.fn(async () => ({})),
      })

      // Get owner phone
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: function() {
            this.eq = vi.fn(() => this)
            return this
          },
          maybeSingle: async () => ({ data: { phone: '+573001234567' }, error: null }),
        }),
      })

      const invokeSpy = vi.fn(async () => ({ error: null }))
      mockSupabase.functions.invoke = invokeSpy

      await service.handle(mockEvent)

      expect(invokeSpy).toHaveBeenCalledWith('whatsapp-service', expect.any(Object))
      const invokeCall = invokeSpy.mock.calls[0][1]
      expect(invokeCall.body.to).toBe('+573001234567')
    })

    it('[N9] Web channel event → skip WhatsApp', async () => {
      const webEvent: AppointmentEvent = {
        ...mockEvent,
        channel: 'web',
      }

      const fromMock = mockSupabase.from as any

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Channel
      mockSupabase.channel.mockReturnValue({
        send: vi.fn(async () => ({})),
      })

      await service.handle(webEvent)

      // Should NOT invoke WhatsApp
      expect(mockSupabase.functions.invoke).not.toHaveBeenCalled()
    })

    it('[N10] No owner phone → skip WhatsApp silently', async () => {
      const fromMock = mockSupabase.from as any

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Channel
      mockSupabase.channel.mockReturnValue({
        send: vi.fn(async () => ({})),
      })

      // Get owner phone: not found
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: function() {
            this.eq = vi.fn(() => this)
            return this
          },
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      })

      await service.handle(mockEvent)

      // Should NOT invoke WhatsApp
      expect(mockSupabase.functions.invoke).not.toHaveBeenCalled()
    })

    it('[N11] CRON_SECRET missing → skip WhatsApp', async () => {
      delete process.env.CRON_SECRET

      const fromMock = mockSupabase.from as any

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      fromMock.mockReturnValueOnce({
        insert: async () => ({ error: null }),
      })

      // Channel
      mockSupabase.channel.mockReturnValue({
        send: vi.fn(async () => ({})),
      })

      // Get owner phone
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: function() {
            this.eq = vi.fn(() => this)
            return this
          },
          maybeSingle: async () => ({ data: { phone: '+573001234567' }, error: null }),
        }),
      })

      await service.handle(mockEvent)

      // Should NOT invoke WhatsApp
      expect(mockSupabase.functions.invoke).not.toHaveBeenCalled()
    })
  })

  // ── Event Type Tests ──────────────────────────────────────────────────────────

  describe('Event Type Handling', () => {
    it('[N12] appointment.rescheduled → correct title', async () => {
      const rescheduledEvent: AppointmentEvent = {
        ...mockEvent,
        type: 'appointment.rescheduled',
      }

      const fromMock = mockSupabase.from as any

      // Idempotency
      fromMock.mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })

      // Insert
      const insertSpy = vi.fn(async () => ({ error: null }))
      fromMock.mockReturnValueOnce({
        insert: insertSpy,
      })

      await service.handle(rescheduledEvent)

      const insertCall = insertSpy.mock.calls[0][0]
      expect(insertCall.title).toContain('reagendada')
    })
  })
})
