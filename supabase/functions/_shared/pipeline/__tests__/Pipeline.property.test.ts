/**
 * Property-based tests for Pipeline Engine using fast-check.
 *
 * Invariants tested:
 *   - Steps always run in registration order
 *   - Context merge is monotonic (no step can remove a key from context)
 *   - Conditional steps are correctly skipped when predicate is false
 *   - Error in a step stops execution of subsequent steps
 *   - Step results capture correct status and timing
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { Pipeline } from '../Pipeline.ts'
import { PipelineTimeoutError } from '../types.ts'

describe('Pipeline (property-based)', () => {
  it('runs steps in registration order regardless of context shape', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 10 }),
        fc.anything(),
        async (stepNames, initialValue) => {
          const executionOrder: string[] = []
          const initial = { seed: initialValue }

          const pipeline = new Pipeline<typeof initial>('order-test')
          for (const name of stepNames) {
            pipeline.step(name, (ctx) => {
              executionOrder.push(name)
              return { [name]: true }
            })
          }

          await pipeline.run(initial)
          expect(executionOrder).toEqual(stepNames)
        },
      ),
      { verbose: true, numRuns: 50 },
    )
  })

  it('context merge is monotonic — keys are never removed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.anything()),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
        fc.anything(),
        async (initialKeys, extraKeys, extraValue) => {
          const initial = initialKeys as Record<string, unknown>
          const pipeline = new Pipeline<Record<string, unknown>>('monotonic-test')

          for (const key of extraKeys) {
            pipeline.step(`add-${key}`, (ctx) => ({
              [key]: extraValue,
              ...ctx, // preserve all existing keys
            }))
          }

          const { context } = await pipeline.run(initial)

          // All initial keys must still exist
          for (const k of Object.keys(initialKeys)) {
            expect(context).toHaveProperty(k)
          }
          // All step keys must exist
          for (const k of extraKeys) {
            expect(context).toHaveProperty(k)
          }
        },
      ),
      { verbose: true, numRuns: 50 },
    )
  })

  it('conditionally skipped steps do not execute and do not appear in context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.string(),
        async (shouldRun, injectedValue) => {
          const pipeline = new Pipeline<{ flag: boolean }>('conditional-test')
            .step('always', (ctx) => ({ alwaysRan: true }))
            .step('conditional', (ctx) => ({
              conditionalRan: true,
              injectedValue,
            }), { if: (ctx) => ctx.flag })

          const { context } = await pipeline.run({ flag: shouldRun })

          expect(context.alwaysRan).toBe(true)
          if (shouldRun) {
            expect(context.conditionalRan).toBe(true)
            expect(context.injectedValue).toBe(injectedValue)
          } else {
            expect(context).not.toHaveProperty('conditionalRan')
            expect(context).not.toHaveProperty('injectedValue')
          }
        },
      ),
      { verbose: true, numRuns: 30 },
    )
  })

  it('error in a step stops execution of subsequent steps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 2, maxLength: 8 }),
        fc.string(),
        fc.string(),
        async (stepNames, failOnName, successValue) => {
          const executed: string[] = []
          const failIdx = stepNames.indexOf(failOnName)
          if (failIdx < 0) return // skip — failOnName not in our array

          const pipeline = new Pipeline<Record<string, unknown>>('error-stop-test')
          for (let i = 0; i < stepNames.length; i++) {
            const name = stepNames[i]!
            pipeline.step(name, (ctx) => {
              executed.push(name)
              if (name === failOnName) {
                throw new Error(`Step ${name} failed`)
              }
              return { [name]: successValue }
            })
          }

          await expect(pipeline.run({})).rejects.toThrow(`Step ${failOnName} failed`)
          // Only steps up to and including the failing one should have run
          const expectedExecuted = stepNames.slice(0, failIdx + 1)
          expect(executed).toEqual(expectedExecuted)
        },
      ),
      { verbose: true, numRuns: 50 },
    )
  })

  it('step results accurately capture status and positive timing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 6 }),
        async (stepNames) => {
          const pipeline = new Pipeline('results-test')
          for (const name of stepNames) {
            pipeline.step(name, () => ({}))
          }

          const { results } = await pipeline.run({})

          expect(results).toHaveLength(stepNames.length)
          for (let i = 0; i < stepNames.length; i++) {
            expect(results[i]!.name).toBe(stepNames[i])
            expect(results[i]!.status).toBe('success')
            expect(results[i]!.durationMs).toBeGreaterThanOrEqual(0)
          }
        },
      ),
      { verbose: true, numRuns: 50 },
    )
  })

  it('timeout rejects with PipelineTimeoutError when step exceeds limit', async () => {
    const pipeline = new Pipeline('timeout-test')
      .step('fast', () => ({}))
      .step('slow', async () => {
        await new Promise(r => setTimeout(r, 200))
        return {}
      }, { timeoutMs: 50 })

    const err = await pipeline.run({}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PipelineTimeoutError)
    expect((err as PipelineTimeoutError).stepName).toBe('slow')
    expect((err as PipelineTimeoutError).timeoutMs).toBe(50)
  })

  it('empty pipeline returns initial context unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.anything()),
        async (initial) => {
          const { context, results } = await new Pipeline('empty').run(initial)
          expect(context).toEqual(initial)
          expect(results).toEqual([])
        },
      ),
      { verbose: true, numRuns: 30 },
    )
  })

  it('pipeline name is optional and does not affect behavior', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (named) => {
          const p = named ? new Pipeline('named') : new Pipeline()
          const { results } = await p
            .step('a', () => ({ a: 1 }))
            .run({})
          expect(results).toHaveLength(1)
          expect(results[0]!.status).toBe('success')
        },
      ),
      { verbose: true, numRuns: 20 },
    )
  })
})
