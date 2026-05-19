import type { SupabaseClient } from '@supabase/supabase-js'
import { Result, ok, fail } from '@/types/result'
import type { IGraphRepository } from '@/lib/domain/repositories/IGraphRepository'
import type {
  Edge,
  EdgeInput,
  EdgeType,
  EntityKind,
  EntityRef,
  FindNeighborsOptions,
} from '@/lib/domain/graph/contracts'

interface EntityRelationshipRow {
  id:          string
  business_id: string
  from_kind:   EntityKind
  from_id:     string
  to_kind:     EntityKind
  to_id:       string
  edge_type:   EdgeType
  confidence:  number
  metadata:    Record<string, unknown>
  created_at:  string
  expires_at:  string | null
}

const TABLE = 'entity_relationships'

function rowToEdge(row: EntityRelationshipRow): Edge {
  return {
    id:         row.id,
    businessId: row.business_id,
    from:       { kind: row.from_kind, id: row.from_id },
    to:         { kind: row.to_kind,   id: row.to_id },
    edgeType:   row.edge_type,
    confidence: row.confidence,
    metadata:   row.metadata,
    createdAt:  row.created_at,
    expiresAt:  row.expires_at,
  }
}

export class SupabaseGraphRepository implements IGraphRepository {
  // deno-lint-ignore no-explicit-any
  constructor(private supabase: SupabaseClient<any>) {}

  async upsertEdge(businessId: string, input: EdgeInput): Promise<Result<Edge>> {
    const payload = {
      business_id: businessId,
      from_kind:   input.from.kind,
      from_id:     input.from.id,
      to_kind:     input.to.kind,
      to_id:       input.to.id,
      edge_type:   input.edgeType,
      confidence:  input.confidence ?? 1,
      metadata:    input.metadata   ?? {},
      expires_at:  input.expiresAt  ?? null,
    }

    const { data, error } = await this.supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'business_id,from_kind,from_id,to_kind,to_id,edge_type' })
      .select('*')
      .single()

    if (error) return fail(`upsertEdge: ${error.message}`)
    if (!data)  return fail('upsertEdge: empty response')

    return ok(rowToEdge(data as EntityRelationshipRow))
  }

  async findNeighbors(
    businessId: string,
    from:       EntityRef,
    opts?:      FindNeighborsOptions,
  ): Promise<Result<ReadonlyArray<Edge>>> {
    let query = this.supabase
      .from(TABLE)
      .select('*')
      .eq('business_id', businessId)
      .eq('from_kind',   from.kind)
      .eq('from_id',     from.id)

    if (opts?.edgeType) query = query.eq('edge_type', opts.edgeType)
    if (opts?.limit)    query = query.limit(opts.limit)

    const { data, error } = await query
    if (error) return fail(`findNeighbors: ${error.message}`)

    return ok((data ?? []).map((r) => rowToEdge(r as EntityRelationshipRow)))
  }

  async findInverseEdges(
    businessId: string,
    to:         EntityRef,
    opts?:      FindNeighborsOptions,
  ): Promise<Result<ReadonlyArray<Edge>>> {
    let query = this.supabase
      .from(TABLE)
      .select('*')
      .eq('business_id', businessId)
      .eq('to_kind',     to.kind)
      .eq('to_id',       to.id)

    if (opts?.edgeType) query = query.eq('edge_type', opts.edgeType)
    if (opts?.limit)    query = query.limit(opts.limit)

    const { data, error } = await query
    if (error) return fail(`findInverseEdges: ${error.message}`)

    return ok((data ?? []).map((r) => rowToEdge(r as EntityRelationshipRow)))
  }

  async removeEdge(businessId: string, id: string): Promise<Result<void>> {
    const { error } = await this.supabase
      .from(TABLE)
      .delete()
      .eq('business_id', businessId)
      .eq('id', id)

    if (error) return fail(`removeEdge: ${error.message}`)
    return ok(undefined)
  }
}
