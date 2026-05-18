import type {
  ISemanticRouter,
  IEmbedder,
  IntentPrototype,
  ClassifyOptions,
  ClassifyResult,
} from './contracts'

/**
 * Semantic router. Single responsibility: classify a user message
 * into one of the canonical intents using cosine similarity against
 * precomputed embeddings.
 *
 * Invariants:
 *   • Never throws — returns null on any failure.
 *   • Pure in-memory math — no DB, no extra HTTP except the one
 *     embedder call. Gte-small embeddings are L2-normalized, so
 *     cosine = dot product (cheap).
 *   • Prototypes are injected — runtime-agnostic and testable.
 */
export class SemanticRouter implements ISemanticRouter {
  private static readonly DEFAULT_THRESHOLD = 0.78

  constructor(
    private readonly embedder:   IEmbedder,
    private readonly prototypes: ReadonlyArray<IntentPrototype>,
    private readonly onError:    (stage: string, error: string) => void = () => {},
  ) {}

  async classify(text: string, opts?: ClassifyOptions): Promise<ClassifyResult | null> {
    if (this.prototypes.length === 0) return null

    const trimmed = text.trim()
    if (!trimmed) return null

    const emb = await this.embedder.embed(trimmed)
    if (!emb.ok) { this.onError('classify.embed', emb.error); return null }

    const threshold = opts?.threshold ?? SemanticRouter.DEFAULT_THRESHOLD

    let best: ClassifyResult | null = null

    for (const proto of this.prototypes) {
      if (proto.embedding.length !== emb.value.length) continue

      const sim = cosine(emb.value, proto.embedding)
      if (sim < threshold) continue
      if (best && sim <= best.confidence) continue

      best = { intent: proto.intent, confidence: sim, matched: proto.text }
    }

    return best
  }
}

/**
 * Dot-product cosine similarity. Assumes both vectors are L2-normalized
 * (gte-small returns normalized embeddings via `normalize: true`).
 *
 * Falls back to full cosine if magnitudes differ noticeably from 1 — defensive
 * against caller mistakes without paying the cost in the common case.
 */
function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!
    const bv = b[i]!
    dot  += av * bv
    magA += av * av
    magB += bv * bv
  }
  // If both already normalized, magA ≈ magB ≈ 1 and dot is the answer.
  if (Math.abs(magA - 1) < 0.01 && Math.abs(magB - 1) < 0.01) return dot
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom > 0 ? dot / denom : 0
}
