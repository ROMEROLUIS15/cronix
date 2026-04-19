import { describe, it, expect, vi } from 'vitest'
import { RegisterPaymentUseCase } from '@/lib/domain/use-cases/RegisterPaymentUseCase'
import type { IFinanceRepository } from '@/lib/domain/repositories'

function makeFinanceRepo(overrides: Partial<IFinanceRepository> = {}): IFinanceRepository {
  return {
    getTransactions:        vi.fn(),
    getExpenses:            vi.fn(),
    createTransaction:      vi.fn().mockResolvedValue({ data: undefined, error: null }),
    createExpense:          vi.fn(),
    findByPaidAtRange:      vi.fn(),
    sumNetAmount:           vi.fn(),
    createTransactionBatch: vi.fn(),
    ...overrides,
  } as unknown as IFinanceRepository
}

describe('RegisterPaymentUseCase', () => {

  it('succeeds and returns void on valid input', async () => {
    const uc     = new RegisterPaymentUseCase(makeFinanceRepo())
    const result = await uc.execute({
      businessId: 'biz-1', appointmentId: 'appt-1', amount: 50000, method: 'cash',
    })

    expect(result.error).toBeNull()
  })

  it('calls createTransaction with correct payload', async () => {
    const repo = makeFinanceRepo()
    const uc   = new RegisterPaymentUseCase(repo)
    await uc.execute({
      businessId: 'biz-1', appointmentId: 'appt-1',
      amount: 75000, method: 'transfer', notes: 'Efectivo',
    })

    expect(repo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id:    'biz-1',
        appointment_id: 'appt-1',
        amount:         75000,
        net_amount:     75000,
        method:         'transfer',
        notes:          'Efectivo',
      })
    )
  })

  it('passes null notes when not provided', async () => {
    const repo = makeFinanceRepo()
    const uc   = new RegisterPaymentUseCase(repo)
    await uc.execute({ businessId: 'biz-1', appointmentId: 'appt-1', amount: 50000, method: 'card' })

    expect(repo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ notes: null })
    )
  })

  it('propagates repo error', async () => {
    const repo = makeFinanceRepo({
      createTransaction: vi.fn().mockResolvedValue({ data: null, error: 'FK violation' }),
    })
    const uc     = new RegisterPaymentUseCase(repo)
    const result = await uc.execute({
      businessId: 'biz-1', appointmentId: 'appt-1', amount: 50000, method: 'cash',
    })

    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })

  it('sets amount and net_amount to the same value', async () => {
    const repo = makeFinanceRepo()
    const uc   = new RegisterPaymentUseCase(repo)
    await uc.execute({ businessId: 'biz-1', appointmentId: 'appt-1', amount: 120000, method: 'cash' })

    const call = (repo.createTransaction as ReturnType<typeof vi.fn>).mock.calls[0]![0]!
    expect(call.amount).toBe(call.net_amount)
  })

  it('does not call other repo methods', async () => {
    const repo = makeFinanceRepo()
    const uc   = new RegisterPaymentUseCase(repo)
    await uc.execute({ businessId: 'biz-1', appointmentId: 'appt-1', amount: 50000, method: 'cash' })

    expect(repo.createExpense).not.toHaveBeenCalled()
    expect(repo.getTransactions).not.toHaveBeenCalled()
  })
})
