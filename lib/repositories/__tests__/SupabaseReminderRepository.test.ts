import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseReminderRepository } from '../SupabaseReminderRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseReminderRepository', () => {
  let mockSupabase: any
  let repository: SupabaseReminderRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseReminderRepository(mockSupabase)
  })

  describe('upsert', () => {
    it('should delete existing pending and insert new reminder', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.upsert('apt_1', 'biz_1', '2026-01-01T10:00:00Z', 60)

      expect(result.error).toBeNull()
      const from = mockSupabase.from('appointment_reminders')
      expect(from.delete).toHaveBeenCalled()
      expect(from.insert).toHaveBeenCalledWith(expect.objectContaining({
        appointment_id: 'apt_1',
        remind_at: '2026-01-01T10:00:00Z',
        status: 'pending'
      }))
    })
  })

  describe('cancelByAppointment', () => {
    it('should mark pending reminders as cancelled', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.cancelByAppointment('apt_1')

      expect(result.error).toBeNull()
      const from = mockSupabase.from('appointment_reminders')
      expect(from.update).toHaveBeenCalledWith({ status: 'cancelled' })
      expect(from.eq).toHaveBeenCalledWith('appointment_id', 'apt_1')
      expect(from.eq).toHaveBeenCalledWith('status', 'pending')
    })
  })

  describe('markSent', () => {
    it('should update status to sent', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.markSent('rem_1')

      expect(result.error).toBeNull()
      const from = mockSupabase.from('appointment_reminders')
      expect(from.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', sent_at: expect.any(String) }))
    })
  })
})
