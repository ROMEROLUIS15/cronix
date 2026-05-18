import type {
  IMemoryEngine,
  IEmbedder,
  IEpisodicStore,
  MemoryScope,
  MemoryRecord,
  MemoryWriteInput,
  RecallOptions,
} from './contracts'

/**
 * Composes Embedder + Store behind a thin façade.
 *
 * Invariants:
 *   • Never throws (so the agent can fire-and-forget writes).
 *   • Returns [] on any failure path (degrade, never block the conversation).
 *   • Logging is delegated via an injected sink — no hard dependency on logger.
 */
export class MemoryEngine implements IMemoryEngine {
  constructor(
    private readonly embedder: IEmbedder,
    private readonly store:    IEpisodicStore,
    private readonly onError:  (stage: string, error: string) => void = () => {},
  ) {}

  async recall(
    scope: MemoryScope,
    query: string,
    opts?: RecallOptions,
  ): Promise<ReadonlyArray<MemoryRecord>> {
    const emb = await this.embedder.embed(query)
    if (!emb.ok) { this.onError('recall.embed', emb.error); return [] }

    const res = await this.store.search(scope, emb.value, opts)
    if (!res.ok) { this.onError('recall.search', res.error); return [] }

    return res.value
  }

  async write(scope: MemoryScope, input: MemoryWriteInput): Promise<void> {
    const emb = await this.embedder.embed(input.content)
    if (!emb.ok) { this.onError('write.embed', emb.error); return }

    const res = await this.store.insert(scope, input, emb.value)
    if (!res.ok) this.onError('write.insert', res.error)
  }
}
