import type { ITraceSink, TraceRecord, Result } from './contracts.ts'

/**
 * LangSmithSink — best-effort export of a TraceRecord to LangSmith.
 *
 * PII-safe: only hashes and aggregate counters leave the system; raw user text
 * and final responses are never transmitted (mirrors PgTraceSink). Map keys are
 * SHA fragments, not content.
 *
 * Runtime-agnostic: no Node- or Deno-specific imports. The host runtime's
 * env-reading composition root (index.ts) resolves the config and injects it,
 * so the env API difference (process.env vs Deno.env) never leaks into here.
 *
 * Duplicated byte-for-byte under both runtimes; a parity test detects drift.
 */

export interface LangSmithSinkConfig {
  readonly apiKey:   string
  readonly endpoint: string
  readonly project:  string
}

export interface LangSmithSinkDeps {
  readonly fetchFn?: typeof fetch
  readonly now?:     () => number
  readonly genId?:   () => string
}

interface LangSmithRunPayload {
  readonly id:           string
  readonly trace_id:     string
  readonly dotted_order: string
  readonly name:         string
  readonly run_type:     'chain'
  readonly start_time:   string
  readonly end_time:     string
  readonly inputs:       Readonly<Record<string, unknown>>
  readonly outputs:      Readonly<Record<string, unknown>>
  readonly extra:        Readonly<Record<string, unknown>>
  readonly tags:         ReadonlyArray<string>
  readonly session_name: string
  readonly error?:       string
}

export class LangSmithSink implements ITraceSink {
  private readonly fetchFn: typeof fetch
  private readonly now:     () => number
  private readonly genId:   () => string

  constructor(
    private readonly config: LangSmithSinkConfig,
    deps: LangSmithSinkDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init))
    this.now     = deps.now     ?? (() => Date.now())
    this.genId   = deps.genId   ?? (() => crypto.randomUUID())
  }

  async write(record: TraceRecord): Promise<Result<{ id: string }>> {
    const id      = this.genId()
    const endMs   = this.now()
    const startMs = endMs - record.latencyMs
    const payload = this.buildPayload(record, id, startMs, endMs)

    try {
      const res = await this.fetchFn(`${this.config.endpoint}/runs`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    this.config.apiKey,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) return { ok: false, error: `LANGSMITH_HTTP_${res.status}` }
      return { ok: true, value: { id } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'LANGSMITH_NETWORK_ERROR' }
    }
  }

  private buildPayload(
    record:  TraceRecord,
    id:      string,
    startMs: number,
    endMs:   number,
  ): LangSmithRunPayload {
    const base: LangSmithRunPayload = {
      id,
      trace_id:     id,
      dotted_order: compactTimestamp(startMs) + id,
      name:         `agent:${record.scope.channel}`,
      run_type:     'chain',
      start_time:   new Date(startMs).toISOString(),
      end_time:     new Date(endMs).toISOString(),
      inputs:       { query_sha: record.queryHash },
      outputs: {
        outcome:        record.outcome,
        final_text_sha: record.finalTextSha,
        total_tokens:   record.totalTokens,
      },
      extra: {
        metadata: {
          ...record.metadata,
          business_id: record.scope.businessId,
          actor_kind:  record.scope.actorKind,
          actor_key:   record.scope.actorKey,
          steps_count: record.stepsCount,
          tools_count: record.toolsCount,
          latency_ms:  record.latencyMs,
          llm_steps:   record.llmSteps,
          tool_calls:  record.toolCalls,
        },
      },
      tags:         [record.scope.channel, record.outcome],
      session_name: this.config.project,
    }
    return record.errorCode ? { ...base, error: record.errorCode } : base
  }
}

/**
 * Compact UTC timestamp `YYYYMMDDTHHMMSSffffffZ` used as the LangSmith
 * dotted_order prefix. Microseconds are padded from millisecond precision.
 */
function compactTimestamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
    `${p(d.getUTCMilliseconds(), 3)}000Z`
  )
}
