import type {
  ExportSummary,
  LatencyBucket,
  SampleRow,
  TokensBucket,
  TrainingSample,
} from './contracts'

/**
 * Pure transformation: raw RPC rows → versioned JSONL schema.
 *
 * Duplicated byte-for-byte under
 * `supabase/functions/_shared/training/TrainingExporter.ts`. A parity test
 * detects drift.
 *
 * Bucketing thresholds live HERE on purpose: tweaks should not require a
 * migration. The exported schema_version stays stable as long as the
 * field SHAPE doesn't change.
 */

const LATENCY_FAST_MAX     = 800
const LATENCY_NORMAL_MAX   = 2000
const LATENCY_SLOW_MAX     = 5000

const TOKENS_LOW_MAX       = 200
const TOKENS_MEDIUM_MAX    = 800
const TOKENS_HIGH_MAX      = 2000

export function bucketLatency(ms: number): LatencyBucket {
  if (ms < LATENCY_FAST_MAX)   return 'fast'
  if (ms < LATENCY_NORMAL_MAX) return 'normal'
  if (ms < LATENCY_SLOW_MAX)   return 'slow'
  return 'critical'
}

export function bucketTokens(n: number): TokensBucket {
  if (n < TOKENS_LOW_MAX)    return 'low'
  if (n < TOKENS_MEDIUM_MAX) return 'medium'
  if (n < TOKENS_HIGH_MAX)   return 'high'
  return 'extreme'
}

export function rowToSample(row: SampleRow): TrainingSample {
  return {
    trace_id:       row.traceId,
    created_at:     row.createdAt,
    channel:        row.channel,
    outcome:        row.outcome,
    error_code:     row.errorCode,
    tool_sequence:  row.toolSequence,
    latency_bucket: bucketLatency(row.latencyMs),
    tokens_bucket:  bucketTokens(row.totalTokens),
    steps_count:    row.stepsCount,
    tools_count:    row.toolsCount,
    intent:         row.intent,
  }
}

export function buildExportSummary(
  rows:       ReadonlyArray<SampleRow>,
  rangeStart: string,
  rangeEnd:   string,
): ExportSummary {
  const samples = rows.map(rowToSample)
  return { sampleCount: samples.length, rangeStart, rangeEnd, samples }
}

export function toJsonl(samples: ReadonlyArray<TrainingSample>): string {
  return samples.map((s) => JSON.stringify(s)).join('\n')
}
