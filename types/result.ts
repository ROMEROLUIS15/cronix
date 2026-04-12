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

/**
 * capture<T> — Adapts a throw-based async function to Promise<Result<T>>.
 *
 * Use at architectural boundaries where the callee may throw (legacy repos,
 * external fetch, JSON.parse, etc.) and the caller needs an explicit Result.
 *
 * Rule: never silence the error — always surface it as result.error so the
 * caller can decide what to do with it.
 *
 * Usage:
 *   const result = await capture(() => appointmentsRepo.getMonthAppointments(...))
 *   if (result.error) { setFetchError(result.error); return }
 *   setMonthApts(result.data)
 */
export async function capture<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(toErrorMessage(e))
  }
}

/**
 * mapResult<T, U> — Transforms the success value of a Result without unwrapping.
 *
 * Use when you have a Result<T> and need a Result<U> by applying a projection.
 * Passes through error results unchanged.
 *
 * Usage:
 *   const names = mapResult(clientsResult, clients => clients.map(c => c.name))
 */
export function mapResult<T, U>(result: Result<T>, fn: (data: T) => U): Result<U> {
  if (result.error !== null) return fail(result.error)
  return ok(fn(result.data))
}
