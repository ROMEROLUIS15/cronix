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

/** Cap de mensajes por sesión — idéntico al cap previo en memory.ts */
const MAX_MESSAGES = 8

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
   * Recupera el historial de mensajes de la sesión activa del usuario.
   * Retorna [] si no hay sesión o si Redis no está disponible.
   */
  async getHistory(userId: string): Promise<LlmMessage[]> {
    try {
      const raw = await redisCommand(['GET', sessionKey(userId)])
      if (!raw || typeof raw !== 'string') return []
      return JSON.parse(raw) as LlmMessage[]
    } catch {
      return []
    }
  },

  /**
   * Añade un mensaje al historial y renueva el TTL de la sesión.
   * El historial se limita a MAX_MESSAGES (sliding window).
   * Fire-safe: los errores se logean pero no interrumpen el flujo.
   */
  async addMessage(userId: string, message: LlmMessage): Promise<void> {
    try {
      const history = await this.getHistory(userId)
      history.push(message)
      const capped = history.slice(-MAX_MESSAGES)

      // SET key value EX ttl — atomic, renovar TTL en cada mensaje
      await redisCommand([
        'SET',
        sessionKey(userId),
        JSON.stringify(capped),
        'EX',
        String(TTL_SECONDS),
      ])
    } catch (err: any) {
      // Fail silently: perder la sesión es mejor que bloquear al usuario
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
