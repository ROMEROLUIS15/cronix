/**
 * Training export contracts. Pure types — runtime-agnostic.
 *
 * Maps the raw `ai_traces_sample_window` RPC output into a stable JSONL
 * schema versioned by TRAINING_SCHEMA_VERSION. The schema MUST be bumped
 * on any breaking change to the row shape — historical exports become
 * un-parsable otherwise.
 *
 * Duplicated byte-for-byte under
 * `supabase/functions/_shared/training/contracts.ts`. Parity test detects drift.
 */

export const TRAINING_SCHEMA_VERSION = 'v1' as const

export type LatencyBucket = 'fast' | 'normal' | 'slow' | 'critical'
export type TokensBucket  = 'low'  | 'medium' | 'high' | 'extreme'
export type TraceOutcome  = 'success' | 'failure' | 'no_action' | 'rate_limited' | 'error'
export type TraceChannel  = 'whatsapp' | 'dashboard' | 'voice-worker'

export interface SampleRow {
  readonly traceId:      string
  readonly createdAt:    string
  readonly channel:      TraceChannel
  readonly outcome:      TraceOutcome
  readonly errorCode:    string | null
  readonly totalTokens:  number
  readonly latencyMs:    number
  readonly stepsCount:   number
  readonly toolsCount:   number
  readonly toolSequence: ReadonlyArray<string>
  readonly intent:       string | null
}

export interface TrainingSample {
  readonly trace_id:       string
  readonly created_at:     string
  readonly channel:        TraceChannel
  readonly outcome:        TraceOutcome
  readonly error_code:     string | null
  readonly tool_sequence:  ReadonlyArray<string>
  readonly latency_bucket: LatencyBucket
  readonly tokens_bucket:  TokensBucket
  readonly steps_count:    number
  readonly tools_count:    number
  readonly intent:         string | null
}

export interface ExportSummary {
  readonly sampleCount: number
  readonly rangeStart:  string
  readonly rangeEnd:    string
  readonly samples:     ReadonlyArray<TrainingSample>
}
