import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseNotificationRepository } from '../SupabaseNotificationRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseNotificationRepository', () => {
  let mockSupabase: any
  let repository: SupabaseNotificationRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseNotificationRepository(mockSupabase)
  })

  describe('create', () => {
    it('should insert a notification successfully', async () => {
      const mockResult = { id: 'n1', title: 'Test' }
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockResult))
      const payload = { business_id: 'biz_1', user_id: 'u1', title: 'Test', content: 'Hi', type: 'info' as any }

      const result = await repository.create(payload)

      expect(result.data).toEqual(mockResult)
      expect(result.error).toBeNull()
      const from = mockSupabase.from('notifications')
      expect(from.insert).toHaveBeenCalledWith([expect.objectContaining({ title: 'Test', is_read: false })])
    })
  })

  describe('markAsRead', () => {
    it('should update is_read status', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.markAsRead('n1', 'biz_1')

      expect(result.error).toBeNull()
      const from = mockSupabase.from('notifications')
      expect(from.update).toHaveBeenCalledWith({ is_read: true })
      expect(from.eq).toHaveBeenCalledWith('id', 'n1')
    })
  })

  describe('deleteOld', () => {
    it('should delete notifications older than a date', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse([{ id: 'old1' }, { id: 'old2' }]))

      const result = await repository.deleteOld('biz_1', 30)

      expect(result.data).toBe(2)
      const from = mockSupabase.from('notifications')
      expect(from.delete).toHaveBeenCalled()
      expect(from.lt).toHaveBeenCalledWith('created_at', expect.any(String))
    })
  })
})
