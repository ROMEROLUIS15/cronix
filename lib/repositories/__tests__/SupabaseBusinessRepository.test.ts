import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseBusinessRepository } from '../SupabaseBusinessRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseBusinessRepository', () => {
  let mockSupabase: any
  let repository: SupabaseBusinessRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseBusinessRepository(mockSupabase)
  })

  describe('getById', () => {
    it('should return business data on success', async () => {
      const mockBiz = { id: 'biz_123', name: 'Test Biz' }
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockBiz))

      const result = await repository.getById('biz_123')

      expect(result.data).toEqual(mockBiz)
      expect(result.error).toBeNull()
      expect(mockSupabase.from).toHaveBeenCalledWith('businesses')
    })

    it('should return error on failure', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, { message: 'Not found' }))

      const result = await repository.getById('biz_invalid')

      expect(result.data).toBeNull()
      expect(result.error).toContain('Error fetching business')
    })
  })

  describe('update', () => {
    it('should update business fields successfully', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.update('biz_123', { name: 'Updated Name' })

      expect(result.error).toBeNull()
      const from = mockSupabase.from('businesses')
      expect(from.update).toHaveBeenCalledWith({ name: 'Updated Name' })
      expect(from.eq).toHaveBeenCalledWith('id', 'biz_123')
    })

    it('should return error when update fails', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, { message: 'Update failed' }))

      const result = await repository.update('biz_123', { name: 'Fail' })

      expect(result.error).toContain('Error updating business')
    })
  })

  describe('updateSettings', () => {
    it('should update business settings JSON', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))
      const newSettings = { theme: 'dark' }

      const result = await repository.updateSettings('biz_123', newSettings)

      expect(result.error).toBeNull()
      const from = mockSupabase.from('businesses')
      expect(from.update).toHaveBeenCalledWith({ settings: newSettings })
    })
  })
})
