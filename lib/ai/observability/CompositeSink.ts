import type { ITraceSink, TraceRecord, Result } from './contracts.ts'

/**
 * CompositeSink — fans a TraceRecord out to one primary sink and zero or more
 * secondary sinks.
 *
 * The primary sink is canonical: its Result is returned to the caller and its
 * trace id is authoritative. Secondary sinks (e.g. LangSmith) are best-effort —
 * a secondary failure is reported via onSecondaryError but NEVER fails the
 * primary write. This is the graceful-degradation contract: observability
 * export must never break primary trace persistence.
 *
 * Duplicated byte-for-byte under both runtimes; a parity test detects drift.
 */
export class CompositeSink implements ITraceSink {
  constructor(
    private readonly primary:          ITraceSink,
    private readonly secondaries:      ReadonlyArray<ITraceSink>,
    private readonly onSecondaryError: (error: string) => void = () => {},
  ) {}

  async write(record: TraceRecord): Promise<Result<{ id: string }>> {
    const [primaryResult, secondaryResults] = await Promise.all([
      this.primary.write(record),
      Promise.all(this.secondaries.map((sink) => this.safeWrite(sink, record))),
    ])

    for (const result of secondaryResults) {
      if (!result.ok) this.onSecondaryError(result.error)
    }

    return primaryResult
  }

  private async safeWrite(
    sink:   ITraceSink,
    record: TraceRecord,
  ): Promise<Result<{ id: string }>> {
    try {
      return await sink.write(record)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'SINK_THREW' }
    }
  }
}
