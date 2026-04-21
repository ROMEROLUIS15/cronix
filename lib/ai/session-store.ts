/**
 * session-store.ts — Persistent session memory via Upstash Redis.
 *
 * Drop-in replacement para memory.ts (MemoryStore in-process).
 *
 * Problema que resuelve:
 *   El Map in-process de memory.ts se borra en cada cold start de Vercel Serverless.
 *   En producción con múltiples instancias, cada instancia tiene su propio Map,
 *   causando que usuarios pierdan el contexto de conversación aleatoriamente.
 *
 * Solución:
 *   Upstash Redis con API REST — compatible con Vercel Edge y Serverless.
 *   TTL de 30 minutos por sesión — la inactividad limpia automáticamente.
 *
 * Degradación elegante:
 *   Si UPSTASH_REDIS_REST_URL no está configurado, retorna [] silenciosamente
 *   (el asistente funciona sin historial — no muere).
 *
 * Variables de entorno requeridas:
 *   UPSTASH_REDIS_REST_URL   = https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN = xxx
 */

import { LlmMessage } from './providers/types'
import { logger } from '@/lib/logger'

// ── Config ────────────────────────────────────────────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

/** Tiempo de inactividad antes de que la sesión expire automáticamente */
const TTL_SECONDS = 30 * 60 // 30 minutos

/** Cap de mensajes por sesión — aumentado de 8 a 20 (10 intercambios) */
const MAX_MESSAGES = 20

// ── Entity Context — persistir entidades de conversación ─────────────────────
// Permite resolver anáforas: "cancélame esta cita" refiere a lastAppointmentId

export interface EntityContext {
  lastClientName?:     string
  lastServiceName?:    string
  lastAppointmentId?:  string
  lastDate?:           string  // ISO YYYY-MM-DD
  lastTime?:           string  // HH:mm
  lastAction?:         'book' | 'reschedule' | 'cancel'
  updatedAt?:          number  // timestamp
}

export interface Session {
  messages:  LlmMessage[]
  entities:  EntityContext
}

// ── Redis HTTP client (sin dependencias externas) ────────────────────────────

/**
 * Wrapper mínimo sobre la REST API de Upstash.
 * No usa el SDK de @upstash/redis para evitar dependencias pesadas en Edge.
 * Retorna null si Redis no está configurado (graceful degradation).
 */
async function redisCommand(segments: string[]): Promise<unknown> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null

  try {
    const path = segments.map(encodeURIComponent).join('/')
    const res  = await fetch(`${UPSTASH_URL}/${path}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    })

    if (!res.ok) {
      logger.warn('SESSION-STORE', `Redis command failed: ${res.status}`)
      return null
    }

    const json = await res.json()
    return json.result ?? null
  } catch (err: any) {
    logger.warn('SESSION-STORE', `Redis connection error: ${err.message}`)
    return null
  }
}

// ── Session Store ─────────────────────────────────────────────────────────────

function sessionKey(userId: string): string {
  return `cronix:session:${userId}`
}

export const sessionStore = {
  /**
   * Recupera la sesión completa (messages + entities).
   * Retorna sesión vacía si no existe o si Redis no está disponible.
   */
  async getSession(userId: string): Promise<Session> {
    try {
      const raw = await redisCommand(['GET', sessionKey(userId)])
      if (!raw || typeof raw !== 'string') {
        return { messages: [], entities: {} }
      }
      const parsed = JSON.parse(raw) as Session
      return {
        messages: parsed.messages || [],
        entities: parsed.entities || {},
      }
    } catch {
      return { messages: [], entities: {} }
    }
  },

  /**
   * Guarda la sesión completa (messages + entities) atomicamente.
   * Cap de MAX_MESSAGES, renueva TTL.
   */
  async saveSession(userId: string, session: Session): Promise<void> {
    try {
      const capped = session.messages.slice(-MAX_MESSAGES)
      const toSave: Session = {
        messages: capped,
        entities: session.entities || {},
      }

      await redisCommand([
        'SET',
        sessionKey(userId),
        JSON.stringify(toSave),
        'EX',
        String(TTL_SECONDS),
      ])
    } catch (err: any) {
      logger.warn('SESSION-STORE', `saveSession failed: ${err.message}`, { userId })
    }
  },

  /**
   * Recupera solo el historial de mensajes (para backward compat).
   * Retorna [] si no hay sesión o si Redis no está disponible.
   */
  async getHistory(userId: string): Promise<LlmMessage[]> {
    const session = await this.getSession(userId)
    return session.messages
  },

  /**
   * Añade un mensaje al historial (para backward compat).
   * Renueva el TTL de la sesión. Fire-safe.
   */
  async addMessage(userId: string, message: LlmMessage): Promise<void> {
    try {
      const session = await this.getSession(userId)
      session.messages.push(message)
      await this.saveSession(userId, session)
    } catch (err: any) {
      logger.warn('SESSION-STORE', `addMessage failed: ${err.message}`, { userId })
    }
  },

  /**
   * Elimina la sesión del usuario (logout, reset manual).
   */
  async clear(userId: string): Promise<void> {
    try {
      await redisCommand(['DEL', sessionKey(userId)])
    } catch {
      // best-effort
    }
  },
}
