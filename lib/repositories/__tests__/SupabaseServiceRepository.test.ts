import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseServiceRepository } from '../SupabaseServiceRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseServiceRepository', () => {
  let mockSupabase: any
  let repository: SupabaseServiceRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseServiceRepository(mockSupabase)
  })

  describe('getAll', () => {
    it('should return services for a business', async () => {
      const mockServices = [{ id: 's1', name: 'Service 1' }, { id: 's2', name: 'Service 2' }]
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockServices))

      const result = await repository.getAll('biz_123')

      expect(result.data).toEqual(mockServices)
      expect(result.error).toBeNull()
      expect(mockSupabase.from).toHaveBeenCalledWith('services')
    })

    it('should return error if fetch fails', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, { message: 'DB Error' }))

      const result = await repository.getAll('biz_123')

      expect(result.data).toBeNull()
      expect(result.error).toContain('Error fetching services')
    })
  })

  describe('create', () => {
    it('should insert a new service', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))
      const payload = { name: 'New Service', description: null, duration_min: 30, price: 100, color: null, category: null, is_active: true }

      const result = await repository.create('biz_123', payload)

      expect(result.error).toBeNull()
      const from = mockSupabase.from('services')
      expect(from.insert).toHaveBeenCalledWith({ ...payload, business_id: 'biz_123' })
    })
  })

  describe('toggleActive', () => {
    it('should toggle is_active status', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.toggleActive('service_123', true) // current is true, should set to false

      expect(result.error).toBeNull()
      const from = mockSupabase.from('services')
      expect(from.update).toHaveBeenCalledWith({ is_active: false })
      expect(from.eq).toHaveBeenCalledWith('id', 'service_123')
    })
  })
})
