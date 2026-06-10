/**
 * Graph layer contracts. Pure types — runtime-agnostic.
 *
 * Maps 1:1 against the entity_relationships table. ENUM members here MUST
 * match the Postgres ENUMs `entity_kind` and `edge_type`; CI parity test
 * detects drift.
 */

export type EntityKind =
  | 'client'
  | 'service'
  | 'staff'
  | 'business'
  | 'appointment'

export type EdgeType =
  | 'aliases_with'
  | 'prefers_time_window'

export interface EntityRef {
  readonly kind: EntityKind
  readonly id:   string
}

export interface Edge {
  readonly id:         string
  readonly businessId: string
  readonly from:       EntityRef
  readonly to:         EntityRef
  readonly edgeType:   EdgeType
  readonly confidence: number
  readonly metadata:   Readonly<Record<string, unknown>>
  readonly createdAt:  string
  readonly expiresAt:  string | null
}

export interface EdgeInput {
  readonly from:        EntityRef
  readonly to:          EntityRef
  readonly edgeType:    EdgeType
  readonly confidence?: number
  readonly metadata?:   Readonly<Record<string, unknown>>
  readonly expiresAt?:  string | null
}

export interface FindNeighborsOptions {
  readonly edgeType?: EdgeType
  readonly limit?:    number
}
