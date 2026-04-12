import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseClientRepository } from '../SupabaseClientRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseClientRepository', () => {
  let mockSupabase: any
  let repository: SupabaseClientRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseClientRepository(mockSupabase)
  })

  describe('getAll', () => {
    it('should return client list for a business', async () => {
      const mockClients = [{ id: 'c1', name: 'John Doe' }, { id: 'c2', name: 'Jane Smith' }]
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockClients))

      const result = await repository.getAll('biz_123')

      expect(result.data).toEqual(mockClients)
      expect(result.error).toBeNull()
      expect(mockSupabase.from).toHaveBeenCalledWith('clients')
    })

    it('should filter deleted clients', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse([]))

      await repository.getAll('biz_123')

      const from = mockSupabase.from('clients')
      expect(from.is).toHaveBeenCalledWith('deleted_at', null)
    })
  })

  describe('getById', () => {
    it('should return null if client not found (PGRST116)', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, { code: 'PGRST116', message: 'Not found' }))

      const result = await repository.getById('c_none', 'biz_123')

      expect(result.data).toBeNull()
      expect(result.error).toBeNull() // Standard behavior for PGRST116 in this project
    })

    it('should return result if client found', async () => {
      const mockClient = { id: 'c1', name: 'John' }
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockClient))

      const result = await repository.getById('c1', 'biz_123')

      expect(result.data).toEqual(mockClient)
    })
  })

  describe('insert', () => {
    it('should insert a new client and return AI-friendly row', async () => {
      const mockRow = { id: 'c3', name: 'New Client', phone: '123' }
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockRow))
      const payload = { name: 'New Client', phone: '123', business_id: 'biz_123' }

      const result = await repository.insert(payload)

      expect(result.data).toEqual(mockRow)
      expect(result.error).toBeNull()
      const from = mockSupabase.from('clients')
      expect(from.insert).toHaveBeenCalledWith(payload)
      expect(from.select).toHaveBeenCalledWith('id, name, phone')
    })
  })
})
