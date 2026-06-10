import type { IEmbedder, Result } from './contracts'

/**
 * Calls Supabase.ai `gte-small` via the embed-text Edge Function.
 * Single responsibility: text → 384-dim normalized vector.
 *
 * Never throws — returns Result<T>. The agent decides how to degrade.
 */
export class SupabaseEdgeEmbedder implements IEmbedder {
  public readonly dimensions = 384

  constructor(
    private readonly endpoint:   string,
    private readonly serviceKey: string,
    private readonly fetchImpl:  typeof fetch = fetch,
    private readonly timeoutMs:  number       = 4000,
  ) {}

  async embed(text: string): Promise<Result<ReadonlyArray<number>>> {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'EMPTY_INPUT' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await this.fetchImpl(this.endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.serviceKey}`,
          'apikey':        this.serviceKey,
        },
        body:   JSON.stringify({ text: trimmed }),
        signal: controller.signal,
      })

      if (!res.ok) {
        return { ok: false, error: `EMBED_HTTP_${res.status}` }
      }

      const payload = await res.json() as { embedding?: unknown }
      if (!Array.isArray(payload.embedding) || payload.embedding.length !== this.dimensions) {
        return { ok: false, error: 'EMBED_SHAPE_MISMATCH' }
      }

      return { ok: true, value: payload.embedding as number[] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `EMBED_NETWORK: ${msg}` }
    } finally {
      clearTimeout(timer)
    }
  }
}
