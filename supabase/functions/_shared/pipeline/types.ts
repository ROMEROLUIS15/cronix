export interface StepOptions<T extends Record<string, unknown>> {
  /** Skip this step unless the predicate returns true. */
  if?: (ctx: T) => boolean | Promise<boolean>
  /** Timeout in ms. Step rejects with PipelineTimeoutError if exceeded. */
  timeoutMs?: number
}

export interface StepResult {
  name:   string
  status: 'success' | 'skipped' | 'error'
  durationMs: number
  error?: string
}

export interface PipelineHooks<T extends Record<string, unknown>> {
  onStepStart?:   (name: string, ctx: Readonly<T>) => void
  onStepComplete?: (result: StepResult, ctx: Readonly<T>) => void | Promise<void>
  onStepError?:   (name: string, error: unknown, ctx: Readonly<T>) => void | Promise<void>
}

export type StepFn<T extends Record<string, unknown>, R extends Record<string, unknown>> =
  (ctx: T) => R | Promise<R>

export class PipelineTimeoutError extends Error {
  constructor(public stepName: string, public timeoutMs: number) {
    super(`Pipeline step "${stepName}" timed out after ${timeoutMs}ms`)
    this.name = 'PipelineTimeoutError'
  }
}
