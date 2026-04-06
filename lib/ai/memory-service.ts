import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryMetadata {
  type: 'user_fact' | 'business_context' | 'preference'
  [key: string]: unknown
}

export interface Memory {
  id:       string
  content:  string
  metadata: MemoryMetadata  // was `any`
  distance: number
}

// Maximum memories returned per retrieval — prevents token bloat and DoS via large limit values
const MAX_RETRIEVE_LIMIT = 10

export class MemoryService {
  private consecutiveFailures = 0
  private disabledUntil       = 0
  private readonly FAILURE_THRESHOLD = 3
  private readonly DISABLE_DURATION  = 15 * 60 * 1000 // 15 min

  private isEmbeddingDisabled(): boolean {
    if (this.disabledUntil > Date.now()) return true
    if (this.disabledUntil > 0 && this.disabledUntil <= Date.now()) {
      // Cool-down expired — give it one more chance
      this.consecutiveFailures = 0
      this.disabledUntil       = 0
    }
    return false
  }

  /**
   * Genera un embedding para un texto usando la Edge Function nativa.
   * Se auto-desactiva por 15 min tras 3 fallos consecutivos.
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    if (this.isEmbeddingDisabled()) return null

    try {
      const supabase      = await createClient()
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
      const embedPromise   = supabase.functions
        .invoke('embed-text', { body: { text: text.trim() } })
        .then(({ data, error }) => {
          if (error) throw error
          return data.embedding as number[]
        })
      const result = await Promise.race([embedPromise, timeoutPromise])

      if (result === null) throw new Error('Embedding timeout')

      this.consecutiveFailures = 0
      return result
    } catch (err: unknown) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        this.disabledUntil = Date.now() + this.DISABLE_DURATION
        logger.warn('MEMORY-SERVICE', `Embedding disabled for 15 min after ${this.FAILURE_THRESHOLD} consecutive failures`)
      } else {
        logger.warn('MEMORY-SERVICE', `Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return null
    }
  }

  /**
   * Busca memorias relevantes para un usuario y negocio.
   * El límite está capeado en MAX_RETRIEVE_LIMIT para evitar sobregasto de tokens.
   */
  async retrieve(userId: string, businessId: string, query: string, limit = 3): Promise<Memory[]> {
    const embedding = await this.generateEmbedding(query)
    if (!embedding) return []

    // Clamp limit: never below 1, never above MAX_RETRIEVE_LIMIT
    const safeLimit = Math.min(Math.max(1, limit), MAX_RETRIEVE_LIMIT)

    try {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: `[${embedding.join(',')}]`,
        match_threshold: 0.78,
        match_count:     safeLimit,
        p_user_id:       userId,
        p_business_id:   businessId,
      } as never)

      if (error) throw error
      return (data as unknown as Memory[]) ?? []
    } catch (err: unknown) {
      logger.warn('MEMORY-SERVICE', `Retrieval failed: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  /**
   * Almacena una nueva memoria si el asistente lo considera relevante.
   * Quota: max 500 memorias por usuario para evitar crecimiento ilimitado.
   */
  async store(
    userId:     string,
    businessId: string,
    content:    string,
    metadata:   MemoryMetadata = { type: 'user_fact' },
  ): Promise<boolean> {
    const embedding = await this.generateEmbedding(content)
    if (!embedding) return false

    try {
      const supabase = await createClient()

      // Quota check: prevent unbounded growth per user
      const { count } = await supabase
        .from('ai_memories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id',    userId)
        .eq('business_id', businessId)

      if ((count ?? 0) >= 500) {
        // Evict the oldest memory to stay within quota (FIFO rotation)
        const { data: oldest } = await supabase
          .from('ai_memories')
          .select('id')
          .eq('user_id',    userId)
          .eq('business_id', businessId)
          .order('created_at', { ascending: true })
          .limit(1)

        if (oldest?.[0]) {
          await supabase.from('ai_memories').delete().eq('id', oldest[0].id)
        }
      }

      const { error } = await supabase
        .from('ai_memories')
        .insert({
          user_id:    userId,
          business_id: businessId,
          content,
          embedding:  `[${embedding.join(',')}]`,
          metadata:   metadata as never,
        } as never)

      if (error) throw error
      logger.info('MEMORY-SERVICE', 'New memory stored successfully', { userId })
      return true
    } catch (err: unknown) {
      logger.error('MEMORY-SERVICE', `Storage failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}

export const memoryService = new MemoryService()
