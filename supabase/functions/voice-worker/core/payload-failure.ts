/**
 * Classifies a failure in the stage before the agent runs (body parse → STT →
 * context load). The early-exit trace records which stage broke, so the turn
 * shows up in /dashboard/observability and counts for the AI-failure alert, and
 * the owner hears a sentence they can act on instead of an internal error.
 */

export type PayloadFailureCode = 'STT_FAILED' | 'CONTEXT_FAILED' | 'PAYLOAD_INVALID'

type TaggedStage = Exclude<PayloadFailureCode, 'PAYLOAD_INVALID'>

class PayloadStageError extends Error {
  constructor(readonly code: TaggedStage, readonly original: unknown) {
    super(`${code}: ${original instanceof Error ? original.message : String(original)}`)
    this.name = 'PayloadStageError'
  }
}

const USER_MESSAGE: Record<PayloadFailureCode, string> = {
  STT_FAILED:      'No pude procesar el audio, ¿puedes repetir?',
  CONTEXT_FAILED:  'No pude cargar los datos de tu negocio. Intenta de nuevo en unos segundos.',
  PAYLOAD_INVALID: 'No pude leer tu mensaje. Intenta de nuevo.',
}

/** Marks a rejection of `promise` as coming from `stage`. */
export function tagStage<T>(stage: TaggedStage, promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => { throw new PayloadStageError(stage, err) })
}

/** Anything not tagged by `tagStage` failed while reading the request body. */
export function classifyPayloadFailure(err: unknown): {
  code:    PayloadFailureCode
  message: string
  cause:   unknown
} {
  const code  = err instanceof PayloadStageError ? err.code : 'PAYLOAD_INVALID'
  const cause = err instanceof PayloadStageError ? err.original : err
  return { code, message: USER_MESSAGE[code], cause }
}
