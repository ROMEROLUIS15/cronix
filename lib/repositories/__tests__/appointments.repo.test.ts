// @ts-nocheck — Legacy test file; SupabaseAppointmentRepository.test.ts is the primary test.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'
import { SupabaseAppointmentRepository } from '../SupabaseAppointmentRepository'
import { isOk, isFail } from '@/types/result'

describe('SupabaseAppointmentRepository', () => {
  let mockSupabase: DeepMockProxy<SupabaseClient<Database>>
  let repository: SupabaseAppointmentRepository

  beforeEach(() => {
    mockSupabase = mockDeep<SupabaseClient<Database>>()
    repository = new SupabaseAppointmentRepository(mockSupabase)
  })

  describe('getMonthAppointments', () => {
    it('returns data when the query is successful', async () => {
      const mockData = [{ id: '1', start_at: '2026-01-01' }]
      
      // Setup mock chain
      const fromMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      }
      mockSupabase.from.mockReturnValue(fromMock as any)

      const result = await repository.getMonthAppointments('biz_123', '2026-01-01', '2026-01-31')

      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.data).toEqual(mockData)
      }
      expect(mockSupabase.from).toHaveBeenCalledWith('appointments')
    })

    it('returns a failed result when the query fails', async () => {
      const mockError = { message: 'Database error' }
      
      const fromMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      }
      mockSupabase.from.mockReturnValue(fromMock as any)

      const result = await repository.getMonthAppointments('biz_123', '2026-01-01', '2026-01-31')

      expect(isFail(result)).toBe(true)
      if (isFail(result)) {
        expect(result.error).toContain('Database error')
      }
    })
  })

  describe('updateStatus', () => {
    it('returns ok when successfully updated', async () => {
      // Mock chain for UPDATE query
      const updateMock = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      
      // Mock chain for SELECT query (cache invalidation)
      const selectMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { business_id: 'biz_123' }, error: null }),
      }
      
      // Return different mocks based on which method is called first
      let callCount = 0
      mockSupabase.from.mockImplementation(() => {
        callCount++
        return callCount === 1 ? (updateMock as any) : (selectMock as any)
      })

      const result = await repository.updateStatus('apt_1', 'confirmed', 'biz_1')

      expect(isOk(result)).toBe(true)
    })
  })
})
