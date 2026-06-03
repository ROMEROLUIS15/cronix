import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  IEpisodicStore,
  MemoryScope,
  MemoryRecord,
  MemoryWriteInput,
  RecallOptions,
  Result,
} from './contracts.ts'

/**
 * Deno port. Identical semantics to the Node implementation.
 * Only place that touches ai_memories_v2 from Edge Functions.
 */
export class PgVectorEpisodicStore implements IEpisodicStore {
  private static readonly DEFAULT_TOP_K     = 5
  private static readonly DEFAULT_THRESHOLD = 0.78

  constructor(private readonly db: SupabaseClient) {}

  async search(
    scope:     MemoryScope,
    embedding: ReadonlyArray<number>,
    opts?:     RecallOptions,
  ): Promise<Result<ReadonlyArray<MemoryRecord>>> {
    const { data, error } = await this.db.rpc('match_ai_memories_v2', {
      p_business_id:     scope.businessId,
      p_actor_kind:      scope.actorKind,
      p_actor_key:       scope.actorKey,
      p_query_embedding: embedding as unknown as number[],
      p_match_threshold: opts?.threshold ?? PgVectorEpisodicStore.DEFAULT_THRESHOLD,
      p_match_count:     opts?.topK      ?? PgVectorEpisodicStore.DEFAULT_TOP_K,
    })

    if (error) return { ok: false, error: error.message }

    const rows = (data ?? []) as Array<{
      id:         string
      content:    string
      kind:       MemoryRecord['kind']
      metadata:   Record<string, unknown>
      similarity: number
      created_at: string
    }>

    return {
      ok: true,
      value: rows.map((r) => ({
        id:         r.id,
        content:    r.content,
        kind:       r.kind,
        similarity: r.similarity,
        metadata:   r.metadata,
        createdAt:  r.created_at,
      })),
    }
  }

  async insert(
    scope:     MemoryScope,
    input:     MemoryWriteInput,
    embedding: ReadonlyArray<number>,
  ): Promise<Result<{ id: string }>> {
    const expiresAt = input.ttlDays
      ? new Date(Date.now() + input.ttlDays * 86_400_000).toISOString()
      : null

    const { data, error } = await this.db
      .from('ai_memories_v2')
      .insert({
        business_id: scope.businessId,
        actor_kind:  scope.actorKind,
        actor_key:   scope.actorKey,
        kind:        input.kind,
        content:     input.content,
        embedding:   embedding as unknown as number[],
        metadata:    input.metadata ?? {},
        expires_at:  expiresAt,
      })
      .select('id')
      .single()

    if (error || !data) return { ok: false, error: error?.message ?? 'INSERT_FAILED' }
    return { ok: true, value: { id: (data as { id: string }).id } }
  }
}
