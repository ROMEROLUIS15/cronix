import type { Result } from '@/types/result'
import type {
  Edge,
  EdgeInput,
  EntityRef,
  FindNeighborsOptions,
} from '@/lib/domain/graph/contracts'

export interface IGraphRepository {
  /**
   * Idempotent edge upsert. Inserting the same (scope + from + to + edgeType)
   * updates confidence/metadata/expires_at without creating a duplicate row.
   */
  upsertEdge(businessId: string, input: EdgeInput): Promise<Result<Edge>>

  /**
   * Outbound neighbors of `from`. When edgeType is supplied, only edges of
   * that type are returned. Order is undefined unless the implementation
   * documents otherwise.
   */
  findNeighbors(
    businessId: string,
    from:       EntityRef,
    opts?:      FindNeighborsOptions,
  ): Promise<Result<ReadonlyArray<Edge>>>

  /**
   * Inverse traversal: edges whose `to` equals the given ref. Symmetric to
   * findNeighbors. Aliases use this to discover "who points at me".
   */
  findInverseEdges(
    businessId: string,
    to:         EntityRef,
    opts?:      FindNeighborsOptions,
  ): Promise<Result<ReadonlyArray<Edge>>>

  /**
   * Removes a single edge by id. Tenant-scoped; the implementation MUST
   * filter by business_id even when the id is unique globally.
   */
  removeEdge(businessId: string, id: string): Promise<Result<void>>
}
