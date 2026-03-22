/**
 * Result<T> — Typed discriminated union for async operations.
 *
 * Replaces throw/catch at architectural boundaries.
 * Use in: Server Actions, repository calls, use-case orchestration.
 *
 * When the backend is decoupled (API layer), the contract stays identical —
 * only the fetcher implementation changes, not the callers.
 *
 * Usage:
 *   function myAction(): Promise<Result<MyData>> { ... }
 *
 *   const result = await myAction()
 *   if (result.error) { showError(result.error); return }
 *   doSomethingWith(result.data)
 */

export type Result<T> =
  | { data: T;    error: null }
  | { data: null; error: string }

/** Wrap a successful value in Result */
export function ok<T>(data: T): Result<T> {
  return { data, error: null }
}

/** Wrap an error message in Result */
export function fail(message: string): Result<never> {
  return { data: null, error: message }
}

/** Type guard — narrows to success branch */
export function isOk<T>(result: Result<T>): result is { data: T; error: null } {
  return result.error === null
}

/** Type guard — narrows to error branch */
export function isFail<T>(result: Result<T>): result is { data: null; error: string } {
  return result.error !== null
}

/**
 * Extracts a user-friendly message from an unknown error.
 * Use inside catch blocks when wrapping to Result.
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Error inesperado. Por favor intenta de nuevo.'
}
