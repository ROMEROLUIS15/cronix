import { LlmMessage } from './providers/types'

/**
 * 🧠 Simple In-Memory Session Store
 * In a real production environment, this should be Redis / Upstash
 * or a Supabase table linked to user_id.
 */
class MemoryStore {
  private sessions: Map<string, LlmMessage[]> = new Map()

  getHistory(userId: string): LlmMessage[] {
    return this.sessions.get(userId) || []
  }

  addMessage(userId: string, message: LlmMessage) {
    const history = this.getHistory(userId)
    history.push(message)
    
    // Keep last 8 messages (4 turns) — sufficient for voice assistant context
    this.sessions.set(userId, history.slice(-8))
  }

  clear(userId: string) {
    this.sessions.delete(userId)
  }
}

export const aiMemory = new MemoryStore()
