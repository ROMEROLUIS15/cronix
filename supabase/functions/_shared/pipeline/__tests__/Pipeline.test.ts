import { describe, it, expect } from 'vitest'
import { Pipeline } from '../Pipeline.ts'

describe('Pipeline', () => {
  it('runs steps in order and merges context', async () => {
    const { context, results } = await new Pipeline<{ start: number }>('test')
      .step('add-one', (ctx) => ({ value: ctx.start + 1 }))
      .step('add-two', (ctx) => ({ value2: (ctx as any).value + 2 }))
      .run({ start: 10 })

    expect(context.value).toBe(11)
    expect(context.value2).toBe(13)
    expect(results.map(r => r.name)).toEqual(['add-one', 'add-two'])
    expect(results.every(r => r.status === 'success')).toBe(true)
  })

  it('skips step when condition returns false', async () => {
    const sideEffects: string[] = []

    await new Pipeline<{ flag: boolean }>('test')
      .step('run-always', (ctx) => {
        sideEffects.push('ran')
        return {}
      })
      .step('skip-me', (ctx) => {
        sideEffects.push('should-not-run')
        return {}
      }, { if: (ctx) => ctx.flag })
      .run({ flag: false })

    expect(sideEffects).toEqual(['ran'])
  })

  it('runs step when condition returns true', async () => {
    const sideEffects: string[] = []

    await new Pipeline<{ flag: boolean }>('test')
      .step('run-always', (ctx) => {
        sideEffects.push('ran')
        return {}
      })
      .step('run-me', (ctx) => {
        sideEffects.push('should-run')
        return {}
      }, { if: (ctx) => ctx.flag })
      .run({ flag: true })

    expect(sideEffects).toEqual(['ran', 'should-run'])
  })

  it('captures step results with status and timing', async () => {
    const { results } = await new Pipeline('test')
      .step('step-a', () => ({}))
      .step('step-b', () => ({}))
      .run({})

    expect(results).toHaveLength(2)
    expect(results[0].name).toBe('step-a')
    expect(results[0].status).toBe('success')
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('throws on step error and stops pipeline', async () => {
    const pipeline = new Pipeline('test')
      .step('good', () => ({}))
      .step('bad', () => { throw new Error('oops') })
      .step('never', () => ({ never: true }))

    await expect(pipeline.run({})).rejects.toThrow('oops')
  })

  it('calls lifecycle hooks', async () => {
    const calls: string[] = []

    const { results } = await new Pipeline('test')
      .on({
        onStepStart: (name) => calls.push(`start:${name}`),
        onStepComplete: (result) => calls.push(`complete:${result.name}:${result.status}`),
      })
      .step('a', () => ({ a: 1 }))
      .step('b', () => ({ b: 2 }))
      .run({})

    expect(calls).toEqual([
      'start:a',
      'complete:a:success',
      'start:b',
      'complete:b:success',
    ])
    expect(results).toHaveLength(2)
  })

  it('rejects on timeout when step exceeds limit', async () => {
    const pipeline = new Pipeline('test')
      .step('slow', async () => {
        await new Promise(r => setTimeout(r, 150))
        return {}
      }, { timeoutMs: 50 })

    await expect(pipeline.run({})).rejects.toThrow('timed out')
  })

  it('supports async condition predicates', async () => {
    const sideEffects: string[] = []

    await new Pipeline<{ val: number }>('test')
      .step('conditional', (ctx) => {
        sideEffects.push('ran')
        return {}
      }, {
        if: async (ctx) => {
          await new Promise(r => setTimeout(r, 5))
          return ctx.val > 5
        },
      })
      .run({ val: 10 })

    expect(sideEffects).toEqual(['ran'])
  })
})
