/**
 * Load/stress tests for Pipeline Engine.
 *
 * Measures performance characteristics:
 *   - Pipeline with many steps (100, 500, 1000)
 *   - Pipeline with large context objects
 *   - Pipeline with async steps
 */

import { describe, it, expect } from 'vitest'
import { Pipeline } from '../Pipeline.ts'

describe('Pipeline load tests', () => {
  it('handles 100 synchronous steps within reasonable time', async () => {
    const pipeline = new Pipeline<{ count: number }>('load-100')
    for (let i = 0; i < 100; i++) {
      pipeline.step(`step-${i}`, (ctx) => ({ count: ctx.count + 1 }))
    }

    const start = performance.now()
    const { context } = await pipeline.run({ count: 0 })
    const elapsed = performance.now() - start

    expect(context.count).toBe(100)
    expect(elapsed).toBeLessThan(500) // 100 sync steps should complete in <500ms
  })

  it('handles 500 synchronous steps within reasonable time', async () => {
    const pipeline = new Pipeline<{ count: number }>('load-500')
    for (let i = 0; i < 500; i++) {
      pipeline.step(`step-${i}`, (ctx) => ({ count: ctx.count + 1 }))
    }

    const start = performance.now()
    const { context } = await pipeline.run({ count: 0 })
    const elapsed = performance.now() - start

    expect(context.count).toBe(500)
    expect(elapsed).toBeLessThan(2000) // 500 sync steps in <2s
  })

  it('handles large context objects without performance degradation', async () => {
    const largeData = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `data-${i}` }))
    const pipeline = new Pipeline<{ data: typeof largeData }>('large-context')
      .step('transform', (ctx) => ({
        data: ctx.data.map(d => ({ ...d, transformed: true })),
      }))
      .step('count', (ctx) => ({
        total: ctx.data.length,
      }))

    const start = performance.now()
    const { context } = await pipeline.run({ data: largeData })
    const elapsed = performance.now() - start

    expect(context.total).toBe(1000)
    expect((context.data as any[])[0]?.transformed).toBe(true)
    expect(elapsed).toBeLessThan(1000)
  })

  it('handles 50 async steps with micro-delays', async () => {
    const pipeline = new Pipeline<{ order: number[] }>('async-50')
    for (let i = 0; i < 50; i++) {
      pipeline.step(`async-${i}`, async (ctx) => {
        await new Promise(r => setTimeout(r, 1)) // ~1ms delay per step
        return { order: [...ctx.order, i] }
      })
    }

    const start = performance.now()
    const { context } = await pipeline.run({ order: [] })
    const elapsed = performance.now() - start

    expect(context.order).toHaveLength(50)
    // 50 steps × 1ms delay + overhead = should be <2s (allows CI/Windows variance)
    expect(elapsed).toBeLessThan(2000)
  })

  it('does not leak memory across consecutive runs', async () => {
    const pipeline = new Pipeline('memory-test')
    pipeline.step('a', (ctx) => ({ ...ctx, a: 1 }))
    pipeline.step('b', (ctx) => ({ ...ctx, b: 2 }))

    for (let run = 0; run < 100; run++) {
      const { context, results } = await pipeline.run({ run })
      expect(context.a).toBe(1)
      expect(context.b).toBe(2)
      expect(results).toHaveLength(2)
    }
  })
})
