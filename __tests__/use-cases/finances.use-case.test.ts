import { describe, it, expect } from 'vitest'
import {
  calculateClientDebt,
  calculateAppointmentDebt,
  buildMonthlyFinanceView,
} from '@/lib/use-cases/finances.use-case'

// ── calculateAppointmentDebt ──────────────────────────────────────────────

describe('calculateAppointmentDebt', () => {
  it('debe retornar el precio completo si no hay transacciones', () => {
    const debt = calculateAppointmentDebt({
      start_at: '2026-01-01T10:00:00Z',
      status: 'completed',
      service: { price: 100 },
      transactions: [],
    })
    expect(debt).toBe(100)
  })

  it('debe retornar la deuda parcial si hay pago parcial', () => {
    const debt = calculateAppointmentDebt({
      start_at: '2026-01-01T10:00:00Z',
      status: 'completed',
      service: { price: 100 },
      transactions: [{ net_amount: 60 }],
    })
    expect(debt).toBe(40)
  })

  it('debe retornar 0 si el pago cubre o excede el precio', () => {
    const debt = calculateAppointmentDebt({
      start_at: '2026-01-01T10:00:00Z',
      status: 'completed',
      service: { price: 100 },
      transactions: [{ net_amount: 100 }],
    })
    expect(debt).toBe(0)
  })

  it('debe retornar 0 si se paga de más (overpaid)', () => {
    const debt = calculateAppointmentDebt({
      start_at: '2026-01-01T10:00:00Z',
      status: 'completed',
      service: { price: 100 },
      transactions: [{ net_amount: 150 }],
    })
    expect(debt).toBe(0)
  })

  it('debe retornar 0 si service es null', () => {
    const debt = calculateAppointmentDebt({
      start_at: '2026-01-01T10:00:00Z',
      status: 'completed',
      service: null,
      transactions: [],
    })
    expect(debt).toBe(0)
  })
})

// ── calculateClientDebt ───────────────────────────────────────────────────

describe('calculateClientDebt', () => {
  it('debe retornar 0 cuando no hay citas', () => {
    expect(calculateClientDebt([])).toBe(0)
  })

  it('debe sumar deudas de citas pasadas no canceladas', () => {
    const debt = calculateClientDebt([
      {
        start_at: '2020-01-01T10:00:00Z',
        status: 'completed',
        service: { price: 100 },
        transactions: [{ net_amount: 40 }],
      },
      {
        start_at: '2020-02-01T10:00:00Z',
        status: 'completed',
        service: { price: 200 },
        transactions: [],
      },
    ])
    expect(debt).toBe(260) // (100-40) + 200
  })

  it('debe excluir citas canceladas y no_show', () => {
    const debt = calculateClientDebt([
      {
        start_at: '2020-01-01T10:00:00Z',
        status: 'cancelled',
        service: { price: 500 },
        transactions: [],
      },
      {
        start_at: '2020-02-01T10:00:00Z',
        status: 'no_show',
        service: { price: 300 },
        transactions: [],
      },
    ])
    expect(debt).toBe(0)
  })

  it('debe excluir citas futuras', () => {
    const debt = calculateClientDebt([
      {
        start_at: '2099-01-01T10:00:00Z',
        status: 'pending',
        service: { price: 100 },
        transactions: [],
      },
    ])
    expect(debt).toBe(0)
  })

  it('debe retornar 0 cuando todas las citas están pagadas', () => {
    const debt = calculateClientDebt([
      {
        start_at: '2020-01-01T10:00:00Z',
        status: 'completed',
        service: { price: 100 },
        transactions: [{ net_amount: 100 }],
      },
    ])
    expect(debt).toBe(0)
  })
})

// ── buildMonthlyFinanceView ───────────────────────────────────────────────

describe('buildMonthlyFinanceView', () => {
  it('deriva utilidad y ratios sobre el dinero COBRADO, no el prestado', () => {
    const view = buildMonthlyFinanceView({ billed: 1000, collected: 800, expenses: 200 })
    expect(view.netProfit).toBe(600)          // 800 - 200
    expect(view.marginPct).toBe(75)           // 600 / 800
    expect(view.expensePct).toBe(25)          // 200 / 800
    expect(view.collectionRate).toBe(80)      // 800 / 1000
  })

  it('evita divisiones por cero cuando no hay datos', () => {
    const view = buildMonthlyFinanceView({ billed: 0, collected: 0, expenses: 0 })
    expect(view).toEqual({
      billed: 0, collected: 0, expenses: 0,
      netProfit: 0, marginPct: 0, expensePct: 0, collectionRate: 0,
    })
  })

  it('capa los porcentajes a 100 y admite utilidad negativa', () => {
    const view = buildMonthlyFinanceView({ billed: 100, collected: 200, expenses: 500 })
    expect(view.netProfit).toBe(-300)
    expect(view.expensePct).toBe(100)         // 500/200 capado
    expect(view.collectionRate).toBe(100)     // 200/100 capado
  })
})
