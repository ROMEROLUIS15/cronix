/**
 * Memory layer contracts. Pure types — runtime-agnostic.
 *
 * These interfaces define the boundary between the agent and the memory
 * subsystem. Implementations live elsewhere; consumers depend only on these.
 *
 * This file is duplicated byte-for-byte under
 * `supabase/functions/_shared/memory/contracts.ts` (Deno runtime cannot
 * import from Node paths). A parity test detects drift.
 */

export type MemoryActorKind = 'user' | 'client_phone'
export type MemoryKind      = 'episodic' | 'preference' | 'fact'

export interface MemoryScope {
  readonly businessId: string
  readonly actorKind:  MemoryActorKind
  readonly actorKey:   string
}

export interface MemoryRecord {
  readonly id:         string
  readonly content:    string
  readonly kind:       MemoryKind
  readonly similarity: number
  readonly metadata:   Readonly<Record<string, unknown>>
  readonly createdAt:  string
}

export interface MemoryWriteInput {
  readonly content:   string
  readonly kind:      MemoryKind
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly ttlDays?:  number
}

export interface RecallOptions {
  readonly topK?:      number
  readonly threshold?: number
}

export type Result<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface IEmbedder {
  readonly dimensions: number
  embed(text: string): Promise<Result<ReadonlyArray<number>>>
}

export interface IEpisodicStore {
  search(
    scope:     MemoryScope,
    embedding: ReadonlyArray<number>,
    opts?:     RecallOptions,
  ): Promise<Result<ReadonlyArray<MemoryRecord>>>

  insert(
    scope:     MemoryScope,
    input:     MemoryWriteInput,
    embedding: ReadonlyArray<number>,
  ): Promise<Result<{ id: string }>>
}

export interface IMemoryEngine {
  recall(scope: MemoryScope, query: string, opts?: RecallOptions): Promise<ReadonlyArray<MemoryRecord>>
  write (scope: MemoryScope, input: MemoryWriteInput): Promise<void>
}
