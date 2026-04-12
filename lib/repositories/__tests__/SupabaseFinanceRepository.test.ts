import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SupabaseFinanceRepository } from '../SupabaseFinanceRepository'
import { createSupabaseMock, mockSupabaseResponse } from './mocks'

describe('SupabaseFinanceRepository', () => {
  let mockSupabase: any
  let repository: SupabaseFinanceRepository

  beforeEach(() => {
    mockSupabase = createSupabaseMock()
    repository = new SupabaseFinanceRepository(mockSupabase)
  })

  describe('getTransactions', () => {
    it('should return transactions for a business', async () => {
      const mockTxns = [{ id: 't1', net_amount: 100 }, { id: 't2', net_amount: 200 }]
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(mockTxns))

      const result = await repository.getTransactions('biz_123')

      expect(result.data).toEqual(mockTxns)
      expect(result.error).toBeNull()
      expect(mockSupabase.from).toHaveBeenCalledWith('transactions')
    })

    it('should apply limit if provided', async () => {
      const resp = mockSupabaseResponse([])
      mockSupabase.from.mockReturnValue(resp)

      await repository.getTransactions('biz_123', { limit: 5 })

      expect(resp.limit).toHaveBeenCalledWith(5)
    })
  })

  describe('createTransaction', () => {
    it('should insert a transaction with default date if not provided', async () => {
      mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))
      const payload = { business_id: 'biz_1', net_amount: 50, amount: 50, method: 'cash' }

      const result = await repository.createTransaction(payload as any)

      expect(result.error).toBeNull()
      const from = mockSupabase.from('transactions')
      expect(from.insert).toHaveBeenCalledWith(expect.objectContaining({
        business_id: 'biz_1',
        net_amount: 50,
        paid_at: expect.any(String)
      }))
    })
  })

  describe('createExpense', () => {
    it('should insert an expense successfully', async () => {
       mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))
       const payload = { business_id: 'biz_1', amount: 30, category: 'supplies', expense_date: '2026-01-01' }

       const result = await repository.createExpense(payload as any)

       expect(result.error).toBeNull()
       const from = mockSupabase.from('expenses')
       expect(from.insert).toHaveBeenCalledWith(payload)
    })
  })
})
