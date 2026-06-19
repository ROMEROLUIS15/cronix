/**
 * Observability layer contracts. Pure types — runtime-agnostic.
 *
 * Duplicated byte-for-byte under `supabase/functions/_shared/observability/contracts.ts`
 * (Deno cannot import from Node paths). A parity test detects drift.
 */

export type TraceChannel    = 'whatsapp' | 'dashboard' | 'voice-worker'
export type TraceActorKind  = 'user'     | 'client_phone'
export type TraceOutcome    = 'success'  | 'failure' | 'no_action' | 'rate_limited' | 'error'
export type ToolStepStatus  = 'success'  | 'error'   | 'timeout'   | 'rate_limited'

export interface TraceScope {
  readonly businessId: string
  readonly channel:    TraceChannel
  readonly actorKind:  TraceActorKind
  readonly actorKey:   string
}

export interface LlmStep {
  readonly model:        string
  readonly latencyMs:    number
  readonly tokens:       number
  readonly hadToolCalls: boolean
}

export interface ToolStep {
  readonly tool:            string
  readonly durationMs:      number
  readonly status:          ToolStepStatus
  readonly argsFingerprint: string
  readonly errorCode?:      string
}

export interface TraceFinish {
  readonly outcome:       TraceOutcome
  readonly errorCode?:    string
  readonly finalTextSha?: string
  /** Extra fields merged into the trace metadata at close time (e.g. scrubbed
   *  conversation text, the booking decision, anti-hallucination flags). */
  readonly metadata?:     Readonly<Record<string, unknown>>
}

export interface TraceRecord {
  readonly scope:        TraceScope
  readonly queryHash:    string
  readonly outcome:      TraceOutcome
  readonly errorCode:    string | null
  readonly finalTextSha: string | null
  readonly totalTokens:  number
  readonly latencyMs:    number
  readonly stepsCount:   number
  readonly toolsCount:   number
  readonly llmSteps:     ReadonlyArray<LlmStep>
  readonly toolCalls:    ReadonlyArray<ToolStep>
  readonly metadata:     Readonly<Record<string, unknown>>
}

export type Result<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: string }

/** Per-turn mutable accumulator. Caller closes it with finish(). */
export interface ITraceHandle {
  recordLlmStep(step: LlmStep):  void
  recordToolCall(step: ToolStep): void
  finish(input: TraceFinish):    Promise<void>
}

export interface ITraceSink {
  write(record: TraceRecord): Promise<Result<{ id: string }>>
}

export interface ITracer {
  start(scope: TraceScope, queryHash: string, metadata?: Readonly<Record<string, unknown>>): ITraceHandle
}
