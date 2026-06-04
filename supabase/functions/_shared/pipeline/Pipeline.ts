import type { StepOptions, StepResult, PipelineHooks, StepFn } from './types.ts'
import { PipelineTimeoutError } from './types.ts'

type StepEntry<T extends Record<string, unknown>> = {
  name:    string
  fn:      StepFn<T, Record<string, unknown>>
  options: StepOptions<T>
}

export class Pipeline<T extends Record<string, unknown>> {
  private steps: StepEntry<any>[] = []
  private hooks: PipelineHooks<T> = {}

  constructor(private pipelineName?: string) {}

  /** Register lifecycle hooks. */
  on(hooks: PipelineHooks<T>): this {
    this.hooks = { ...this.hooks, ...hooks }
    return this
  }

  /**
   * Register a step. The step function receives the current context and returns
   * a partial object that gets merged into the context for downstream steps.
   *
   * TypeScript tip: provide the input context type explicitly, e.g.:
   *   pipeline.step<{ myKey: string }>('my-step', (ctx) => ...)
   */
  step<R extends Record<string, unknown>>(
    name:    string,
    fn:      StepFn<T & Record<string, unknown>, R>,
    options?: StepOptions<T & Record<string, unknown>>,
  ): Pipeline<T & R> {
    this.steps.push({
      name,
      fn: fn as StepFn<T, Record<string, unknown>>,
      options: options ?? {},
    })
    return this as unknown as Pipeline<T & R>
  }

  /**
   * Execute the pipeline. Steps run sequentially, each receiving the accumulated
   * context from all previous steps. The context starts as `initial` and grows
   * as each step's return value is merged via Object.assign.
   */
  async run(initial: T): Promise<{
    context: T & Record<string, unknown>
    results: StepResult[]
  }> {
    const ctx = { ...initial } as T & Record<string, unknown>
    const results: StepResult[] = []

    for (const step of this.steps) {
      const start = Date.now()

      // Condition check
      let shouldRun = true
      let predicateError: string | undefined
      if (step.options.if) {
        try {
          shouldRun = await step.options.if(ctx)
        } catch (err) {
          // A throwing predicate skips the step (fail-closed), but the error is
          // surfaced in the StepResult instead of being silently swallowed.
          shouldRun = false
          predicateError = err instanceof Error ? err.message : String(err)
        }
      }

      if (!shouldRun) {
        results.push({
          name: step.name,
          status: 'skipped',
          durationMs: Date.now() - start,
          ...(predicateError ? { error: predicateError } : {}),
        })
        continue
      }

      this.hooks.onStepStart?.(step.name, ctx)

      // Execute with optional timeout
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      try {
        const timeoutMs = step.options.timeoutMs
        const timer: Promise<never> | null = timeoutMs
          ? new Promise((_, reject) => {
              timeoutHandle = setTimeout(() => reject(new PipelineTimeoutError(step.name, timeoutMs)), timeoutMs)
            })
          : null

        const result = timer
          ? await Promise.race([step.fn(ctx), timer])
          : await step.fn(ctx)

        Object.assign(ctx, result)

        const sr: StepResult = { name: step.name, status: 'success', durationMs: Date.now() - start }
        results.push(sr)
        await this.hooks.onStepComplete?.(sr, ctx)
      } catch (err) {
        const sr: StepResult = {
          name: step.name,
          status: 'error',
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        }
        results.push(sr)
        await this.hooks.onStepError?.(step.name, err, ctx)
        throw err
      } finally {
        // Clear the timeout timer so a step that won the race doesn't leave a
        // dangling timer keeping the event loop alive.
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    }

    return { context: ctx, results }
  }
}
