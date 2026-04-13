/**
 * Finance Validation Schema — Unit Tests
 *
 * Tests for lib/validations/finance.schema.ts
 */
import { describe, it, expect } from 'vitest'

import { CreateTransactionSchema, CreateExpenseSchema } from '@/lib/validations/finance.schema'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Finance Validation Schemas', () => {
  describe('CreateTransactionSchema', () => {
    it('accepts valid transaction', () => {
      const result = CreateTransactionSchema.safeParse({
        business_id: '123e4567-e89b-12d3-a456-426614174000',
        appointment_id: '123e4567-e89b-12d3-a456-426614174001',
        amount: 150.00,
        method: 'cash',
        notes: 'Haircut service',
      })
      expect(result.success).toBe(true)
    })

    it('rejects negative amount', () => {
      const result = CreateTransactionSchema.safeParse({
        business_id: 'biz-123',
        client_id: 'client-456',
        service_ids: ['svc-1'],
        payment_method: 'cash',
        net_amount: -50,
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing required fields', () => {
      const result = CreateTransactionSchema.safeParse({
        business_id: 'biz-123',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('CreateExpenseSchema', () => {
    it('accepts valid expense', () => {
      const result = CreateExpenseSchema.safeParse({
        business_id: '123e4567-e89b-12d3-a456-426614174000',
        category: 'supplies',
        amount: 75.50,
        description: 'Hair products',
        expense_date: '2026-04-10',
      })
      expect(result.success).toBe(true)
    })

    it('rejects negative amount', () => {
      const result = CreateExpenseSchema.safeParse({
        business_id: 'biz-123',
        category: 'supplies',
        amount: -20,
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing required fields', () => {
      const result = CreateExpenseSchema.safeParse({
        business_id: 'biz-123',
      })
      expect(result.success).toBe(false)
    })
  })
})
