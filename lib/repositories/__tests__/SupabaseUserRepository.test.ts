import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseUserRepository } from '../SupabaseUserRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseUserRepository', () => {
  let mockSupabase: any
  let repository: SupabaseUserRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseUserRepository(mockSupabase)
  })

  describe('getBusinessContext', () => {
    it('should return context for logged in user', async () => {
      const mockAuthUser = { id: 'u1' }
      const mockDbUser = { business_id: 'biz_1', name: 'Luis R.', role: 'owner' }
      
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockAuthUser }, error: null })
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockDbUser))

      const result = await repository.getBusinessContext()

      expect(result.data).toEqual({
        userId: 'u1',
        businessId: 'biz_1',
        userName: 'Luis',
        userRole: 'owner'
      })
      expect(result.error).toBeNull()
    })

    it('should return null if no auth user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })

      const result = await repository.getBusinessContext()

      expect(result.data).toBeNull()
      expect(result.error).toBeNull()
    })
  })

  describe('getTeamMembers', () => {
    it('should return staff list', async () => {
      const mockTeam = [{ id: 'u1', name: 'Luis' }, { id: 'u2', name: 'Ana' }]
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockTeam))

      const result = await repository.getTeamMembers('biz_123')

      expect(result.data).toEqual(mockTeam)
      expect(mockSupabase.from).toHaveBeenCalledWith('users')
    })
  })

  describe('deleteEmployee', () => {
    /**
     * deleteEmployee uses: .select('id', { count: 'exact', head: true }).eq().eq()
     * The result is awaited as { count, error } — NOT via .single() or .maybeSingle().
     * We must build a thenable chain that resolves to { count, error } directly.
     */
    function makeCountChain(count: number | null, error: any = null) {
      const chain: any = {
        eq: vi.fn().mockImplementation(() => chain),
        then: (onfulfilled?: any) =>
          Promise.resolve({ count, error }).then(onfulfilled),
        catch: (onrejected?: any) =>
          Promise.resolve({ count, error }).catch(onrejected),
        finally: (onfinally?: any) =>
          Promise.resolve({ count, error }).finally(onfinally),
      }
      // select() returns the same chainable object
      chain.select = vi.fn().mockReturnValue(chain)
      return chain
    }

    it('should fail if employee has appointments', async () => {
      const aptChain  = makeCountChain(5)
      const userResp  = mockSupabaseResponse(null, null)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'appointments') return aptChain
        return userResp
      })

      const result = await repository.deleteEmployee('e1', 'biz_1')

      expect(result.error).toContain('este empleado tiene 5 cita(s)')
    })

    it('should delete if no appointments', async () => {
      const aptChain = makeCountChain(0)
      const userResp = mockSupabaseResponse(null, null)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'appointments') return aptChain
        if (table === 'users') return userResp
        return mockSupabaseResponse(null)
      })

      const result = await repository.deleteEmployee('e1', 'biz_1')

      expect(result.error).toBeNull()
    })
  })
})
