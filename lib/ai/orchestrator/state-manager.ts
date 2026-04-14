/**
 * state-manager.ts — ConversationState lifecycle management.
 *
 * Responsibilities:
 *   - Load / save ConversationState from persistent storage
 *   - Transition between flows (idle → collecting → confirming → idle)
 *   - Merge extracted data into the draft
 *   - Recalculate missing fields
 *   - Reset state when a flow completes or expires
 *
 * This module does NOT make decisions. It does NOT execute actions.
 * It only manages the state machine.
 */

import { Redis } from '@upstash/redis'
import type {
  ConversationState,
  ConversationFlow,
  DraftPayload,
  AiChannel,
} from './types'

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IStateManager {
  /** Load state from storage. Returns null if no active session. */
  load(userId: string, businessId: string): Promise<ConversationState | null>

  /** Create a fresh state for a new conversation. */
  create(params: {
    userId: string
    businessId: string
    channel: AiChannel
  }): ConversationState

  /** Transition to a new flow. Clears draft if transitioning to 'idle'. */
  transition(state: ConversationState, newFlow: ConversationFlow): void

  /** Merge partial data into the current draft. Creates draft if null. */
  merge(state: ConversationState, partial: Partial<DraftPayload>): void

  /** Recalculate which fields are missing based on the current draft. */
  recalculateMissing(state: ConversationState, requiredFields: string[]): void

  /** Reset state to idle. Clears draft, zeros turn count. */
  reset(state: ConversationState): void

  /** Persist the current state to storage. */
  persist(state: ConversationState): Promise<void>

  /** Check if the conversation has exceeded its turn budget. */
  shouldAbort(state: ConversationState): boolean

  /** Increment the turn counter. */
  incrementTurn(state: ConversationState): void
}

// ── In-Memory Implementation (for Phase 1 — replaced by Redis in Phase 3) ─────

/**
 * In-memory store that maps (userId, businessId) → ConversationState.
 *
 * Used during Phase 1 so the orchestrator is fully functional for testing.
 * Will be replaced by RedisStateManager in Phase 3 without changing any
 * orchestrator code — only the implementation of IStateManager changes.
 */
const memoryStore = new Map<string, ConversationState>()

function stateKey(userId: string, businessId: string): string {
  return `${userId}:${businessId}`
}

function generateSessionId(): string {
  // Simple UUID v4 placeholder. In production, use crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export class InMemoryStateManager implements IStateManager {
  async load(userId: string, businessId: string): Promise<ConversationState | null> {
    return memoryStore.get(stateKey(userId, businessId)) ?? null
  }

  create(params: {
    userId: string
    businessId: string
    channel: AiChannel
  }): ConversationState {
    const now = new Date().toISOString()
    const state: ConversationState = {
      sessionId: generateSessionId(),
      userId: params.userId,
      businessId: params.businessId,
      channel: params.channel,
      flow: 'idle',
      draft: null,
      missingFields: [],
      lastIntent: null,
      lastToolCalls: null,
      turnCount: 0,
      maxTurns: 6,
      createdAt: now,
      updatedAt: now,
    }
    memoryStore.set(stateKey(params.userId, params.businessId), state)
    return state
  }

  transition(state: ConversationState, newFlow: ConversationFlow): void {
    state.flow = newFlow
    state.updatedAt = new Date().toISOString()

    if (newFlow === 'idle') {
      state.draft = null
      state.missingFields = []
      state.lastIntent = null
    }
  }

  merge(state: ConversationState, partial: Partial<DraftPayload>): void {
    if (!state.draft) {
      state.draft = {} as DraftPayload
    }

    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined && value !== null) {
        (state.draft as Record<string, unknown>)[key] = value
      }
    }

    state.updatedAt = new Date().toISOString()
  }

  recalculateMissing(state: ConversationState, requiredFields: string[]): void {
    if (!state.draft) {
      state.missingFields = [...requiredFields]
      return
    }

    state.missingFields = requiredFields.filter((field) => {
      const value = (state.draft as Record<string, unknown>)[field]
      return value === undefined || value === null || value === ''
    })

    state.updatedAt = new Date().toISOString()
  }

  reset(state: ConversationState): void {
    state.flow = 'idle'
    state.draft = null
    state.missingFields = []
    state.lastIntent = null
    state.lastToolCalls = null
    state.turnCount = 0
    state.updatedAt = new Date().toISOString()
  }

  async persist(state: ConversationState): Promise<void> {
    memoryStore.set(stateKey(state.userId, state.businessId), state)
  }

  shouldAbort(state: ConversationState): boolean {
    return state.turnCount >= state.maxTurns
  }

  incrementTurn(state: ConversationState): void {
    state.turnCount++
    state.updatedAt = new Date().toISOString()
  }
}

// ── Redis singleton ────────────────────────────────────────────────────────────

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

const STATE_TTL_SECS = 30 * 60 // 30 min — same TTL as session-store.ts

function redisStateKey(userId: string, businessId: string): string {
  return `conv:state:${userId}:${businessId}`
}

// ── RedisStateManager ─────────────────────────────────────────────────────────
// Production implementation of IStateManager.
// load() and persist() talk to Upstash; all domain logic is identical to
// InMemoryStateManager. Falls back gracefully when Redis is unavailable:
// load() returns null → orchestrator creates fresh state; persist() is no-op.

export class RedisStateManager implements IStateManager {
  async load(userId: string, businessId: string): Promise<ConversationState | null> {
    const redis = getRedis()
    if (!redis) return null
    try {
      return await redis.get<ConversationState>(redisStateKey(userId, businessId))
    } catch {
      return null
    }
  }

  create(params: {
    userId: string
    businessId: string
    channel: AiChannel
  }): ConversationState {
    const now = new Date().toISOString()
    return {
      sessionId:     crypto.randomUUID(),
      userId:        params.userId,
      businessId:    params.businessId,
      channel:       params.channel,
      flow:          'idle',
      draft:         null,
      missingFields: [],
      lastIntent:    null,
      lastToolCalls: null,
      turnCount:     0,
      maxTurns:      6,
      createdAt:     now,
      updatedAt:     now,
    }
  }

  transition(state: ConversationState, newFlow: ConversationFlow): void {
    state.flow      = newFlow
    state.updatedAt = new Date().toISOString()
    if (newFlow === 'idle') {
      state.draft         = null
      state.missingFields = []
      state.lastIntent    = null
    }
  }

  merge(state: ConversationState, partial: Partial<DraftPayload>): void {
    if (!state.draft) state.draft = {} as DraftPayload
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined && value !== null) {
        (state.draft as Record<string, unknown>)[key] = value
      }
    }
    state.updatedAt = new Date().toISOString()
  }

  recalculateMissing(state: ConversationState, requiredFields: string[]): void {
    if (!state.draft) {
      state.missingFields = [...requiredFields]
      return
    }
    state.missingFields = requiredFields.filter((field) => {
      const value = (state.draft as Record<string, unknown>)[field]
      return value === undefined || value === null || value === ''
    })
    state.updatedAt = new Date().toISOString()
  }

  reset(state: ConversationState): void {
    state.flow          = 'idle'
    state.draft         = null
    state.missingFields = []
    state.lastIntent    = null
    state.lastToolCalls = null
    state.turnCount     = 0
    state.updatedAt     = new Date().toISOString()
  }

  async persist(state: ConversationState): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    try {
      await redis.set(redisStateKey(state.userId, state.businessId), state, { ex: STATE_TTL_SECS })
    } catch { /* fail silently — conversation continues without persistence */ }
  }

  shouldAbort(state: ConversationState): boolean {
    return state.turnCount >= state.maxTurns
  }

  incrementTurn(state: ConversationState): void {
    state.turnCount++
    state.updatedAt = new Date().toISOString()
  }
}

export const stateManager: IStateManager = new RedisStateManager()
