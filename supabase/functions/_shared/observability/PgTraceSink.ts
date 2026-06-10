import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import type { ITraceSink, TraceRecord, Result } from './contracts.ts'

/**
 * Deno port. Identical semantics to the Node implementation.
 */
export class PgTraceSink implements ITraceSink {
  constructor(private readonly db: SupabaseClient) {}

  async write(record: TraceRecord): Promise<Result<{ id: string }>> {
    const { data, error } = await this.db
      .from('ai_traces')
      .insert({
        business_id:    record.scope.businessId,
        channel:        record.scope.channel,
        actor_kind:     record.scope.actorKind,
        actor_key:      record.scope.actorKey,
        query_sha:      record.queryHash,
        outcome:        record.outcome,
        error_code:     record.errorCode,
        final_text_sha: record.finalTextSha,
        total_tokens:   record.totalTokens,
        latency_ms:     record.latencyMs,
        steps_count:    record.stepsCount,
        tools_count:    record.toolsCount,
        llm_steps:      record.llmSteps,
        tool_calls:     record.toolCalls,
        metadata:       record.metadata,
      })
      .select('id')
      .single()

    if (error || !data) return { ok: false, error: error?.message ?? 'INSERT_FAILED' }
    return { ok: true, value: { id: (data as { id: string }).id } }
  }
}
