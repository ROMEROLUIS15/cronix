import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface Memory {
  id: string
  content: string
  metadata: any
  distance: number
}

export class MemoryService {
  private consecutiveFailures = 0
  private disabledUntil = 0
  private readonly FAILURE_THRESHOLD = 3
  private readonly DISABLE_DURATION  = 15 * 60 * 1000 // 15 min

  private isEmbeddingDisabled(): boolean {
    if (this.disabledUntil > Date.now()) return true
    if (this.disabledUntil > 0 && this.disabledUntil <= Date.now()) {
      // Cool-down expired — give it one more chance
      this.consecutiveFailures = 0
      this.disabledUntil = 0
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
      const supabase = await createClient()
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
      const embedPromise = supabase.functions.invoke('embed-text', { body: { text: text.trim() } })
        .then(({ data, error }) => {
          if (error) throw error
          return data.embedding as number[]
        })
      const result = await Promise.race([embedPromise, timeoutPromise])

      if (result === null) throw new Error('Embedding timeout')

      this.consecutiveFailures = 0
      return result
    } catch (err: any) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        this.disabledUntil = Date.now() + this.DISABLE_DURATION
        logger.warn('MEMORY-SERVICE', `Embedding disabled for 15 min after ${this.FAILURE_THRESHOLD} consecutive failures`)
      } else {
        logger.warn('MEMORY-SERVICE', `Embedding generation failed: ${err.message}`)
      }
      return null
    }
  }

  /**
   * Busca memorias relevantes para un usuario y negocio.
   */
  async retrieve(userId: string, businessId: string, query: string, limit: number = 3): Promise<Memory[]> {
    const embedding = await this.generateEmbedding(query)
    if (!embedding) return []

    try {
      const supabase = await createClient()
      
      // We use a RPC (Remote Procedure Call) for vector similarity search
      // The function 'match_memories' needs to be created in Supabase (DDL)
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: `[${embedding.join(',')}]`,
        match_threshold: 0.78,
        match_count: limit,
        p_user_id: userId,
        p_business_id: businessId
      } as any)

      if (error) throw error
      return (data as any[]) || []
    } catch (err: any) {
      logger.warn('MEMORY-SERVICE', `Retrieval failed: ${err.message}`)
      return []
    }
  }

  /**
   * Almacena una nueva memoria si el asistente lo considera relevante.
   * Quota: max 500 memorias por usuario para evitar crecimiento ilimitado.
   */
  async store(userId: string, businessId: string, content: string, metadata: any = {}): Promise<boolean> {
    const embedding = await this.generateEmbedding(content)
    if (!embedding) return false

    try {
      const supabase = await createClient()

      // Quota check: prevent unbounded growth per user
      const { count } = await supabase
        .from('ai_memories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('business_id', businessId)

      if ((count ?? 0) >= 500) {
        // Evict the oldest memory to stay within quota (FIFO rotation)
        const { data: oldest } = await supabase
          .from('ai_memories')
          .select('id')
          .eq('user_id', userId)
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
          user_id: userId,
          business_id: businessId,
          content,
          embedding: `[${embedding.join(',')}]`,
          metadata: metadata as any
        } as any)

      if (error) throw error
      logger.info('MEMORY-SERVICE', 'New memory stored successfully', { userId })
      return true
    } catch (err: any) {
      logger.error('MEMORY-SERVICE', `Storage failed: ${err.message}`)
      return false
    }
  }
}

export const memoryService = new MemoryService()
