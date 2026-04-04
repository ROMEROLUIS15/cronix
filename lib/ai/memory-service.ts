import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface Memory {
  id: string
  content: string
  metadata: any
  distance: number
}

export class MemoryService {
  /**
   * Genera un embedding para un texto usando la Edge Function nativa.
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.functions.invoke('embed-text', {
        body: { text: text.trim() }
      })

      if (error) throw error
      return data.embedding as number[]
    } catch (err: any) {
      logger.error('MEMORY-SERVICE', `Embedding generation failed: ${err.message}`)
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
   */
  async store(userId: string, businessId: string, content: string, metadata: any = {}): Promise<boolean> {
    const embedding = await this.generateEmbedding(content)
    if (!embedding) return false

    try {
      const supabase = await createClient()
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
