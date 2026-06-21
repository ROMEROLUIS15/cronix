import type { StepOptions, StepResult, PipelineHooks, StepFn } from './types.ts'
import { PipelineTimeoutError } from './types.ts'

type AnyRecord = Record<string, unknown>
type StepEntry = {
  name:    string
  fn:      StepFn<AnyRecord, AnyRecord>
  options: StepOptions<AnyRecord>
}

/**
 * `TInput` is what `.run()` accepts (the initial context); `TCtx` is what each step sees,
 * growing via `.step()`. Keeping them separate is why `.run(initial)` takes ONLY the input
 * — not the fully-accumulated type. `TCtx` defaults to `TInput` for the no-steps case.
 */
export class Pipeline<
  TInput extends Record<string, unknown>,
  TCtx   extends Record<string, unknown> = TInput,
> {
  private steps: StepEntry[] = []
  private hooks: PipelineHooks<TCtx> = {}

  constructor(private pipelineName?: string) {}

  /** Register lifecycle hooks. */
  on(hooks: PipelineHooks<TCtx>): this {
    this.hooks = { ...this.hooks, ...hooks }
    return this
  }

  /**
   * Register a step. The step function receives the accumulated context and returns
   * a partial object that gets merged into the context for downstream steps.
   */
  step<R extends Record<string, unknown>>(
    name:    string,
    fn:      StepFn<TCtx, R>,
    options?: StepOptions<TCtx>,
  ): Pipeline<TInput, TCtx & R> {
    this.steps.push({
      name,
      fn: fn as unknown as StepFn<AnyRecord, AnyRecord>,
      options: (options ?? {}) as StepOptions<AnyRecord>,
    })
    return this as unknown as Pipeline<TInput, TCtx & R>
  }

  /**
   * Execute the pipeline. Steps run sequentially, each receiving the accumulated
   * context from all previous steps. The context starts as `initial` and grows
   * as each step's return value is merged via Object.assign.
   */
  async run(initial: TInput): Promise<{
    context: TCtx & Record<string, unknown>
    results: StepResult[]
  }> {
    const ctx = { ...initial } as unknown as TCtx & Record<string, unknown>
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
