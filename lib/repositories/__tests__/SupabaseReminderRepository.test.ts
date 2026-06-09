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
    it('should call atomic RPC instead of delete + insert', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const result = await repository.upsert('apt_1', 'biz_1', '2026-01-01T10:00:00Z', 60)

      expect(result.error).toBeNull()
      expect(mockSupabase.rpc).toHaveBeenCalledWith('fn_upsert_reminder', {
        p_appointment_id: 'apt_1',
        p_business_id:    'biz_1',
        p_remind_at:      '2026-01-01T10:00:00Z',
        p_minutes_before: 60,
      })
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
