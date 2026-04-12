import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseAppointmentRepository } from '../SupabaseAppointmentRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'
import { isOk, isFail } from '@/types/result'

describe('SupabaseAppointmentRepository', () => {
  let mockSupabase: any
  let repository: SupabaseAppointmentRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseAppointmentRepository(mockSupabase)
  })

  describe('getMonthAppointments', () => {
    it('returns data when the query is successful', async () => {
      const mockData = [{ id: '1', start_at: '2026-01-01' }]
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockData))

      const result = await repository.getMonthAppointments('biz_123', '2026-01-01', '2026-01-31')

      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.data).toEqual(mockData)
      }
      expect(mockSupabase.from).toHaveBeenCalledWith('appointments')
    })

    it('returns a failed result when the query fails', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, { message: 'Database error' }))

      const result = await repository.getMonthAppointments('biz_123', '2026-01-01', '2026-01-31')

      expect(isFail(result)).toBe(true)
      if (isFail(result)) {
        expect(result.error).toContain('Database error')
      }
    })
  })

  describe('updateStatus', () => {
    it('returns ok when successfully updated', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))

      const result = await repository.updateStatus('apt_1', 'confirmed', 'biz_1')

      if (isFail(result)) {
        console.error('Test failed with error:', result.error)
      }
      expect(isOk(result)).toBe(true)
      const from = mockSupabase.from('appointments')
      expect(from.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
      expect(from.eq).toHaveBeenCalledWith('id', 'apt_1')
    })
  })

  describe('create', () => {
    it('should insert a new appointment and return it', async () => {
      const mockApt = { id: 'apt_100', status: 'pending' }
      mockSupabase.from.mockImplementation((table: string) => {
        return mockSupabaseResponse(table === 'appointments' ? mockApt : null)
      })

      const payload = {
        business_id: 'biz_1',
        client_id: 'c1',
        service_ids: ['s1'],
        assigned_user_id: null,
        start_at: '2026-01-01T10:00:00Z',
        end_at: '2026-01-01T11:00:00Z',
        status: 'confirmed',
        notes: null,
        is_dual_booking: false,
      }

      const result = await repository.create(payload)

      if (isFail(result)) {
        console.error('Create test failed:', result.error)
      }
      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.data).toEqual(mockApt)
      }
    })
  })
})
