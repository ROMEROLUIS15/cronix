/**
 * Voice agent session — single source of truth for conversation persistence.
 *
 * Owns the session schema (messages + lastReferencedAppointment) and the
 * cascade fallback: prefer the Redis-backed session when available, fall
 * back to the client-supplied history sent by the FAB, default to empty.
 *
 * `lastReferencedAppointment` lets anaphoric follow-ups ("mejor para otro
 * día", "cancélala") resolve without forcing the LLM to dig through prose
 * history. Capabilities update it after a successful write; reschedule /
 * cancel read it when the user doesn't name a client.
 */

import { redisGet, redisSet } from '../redis.ts'

export type Role = 'user' | 'assistant'

export interface SessionMessage {
  role:    Role
  content: string
}

export interface LastReferencedAppointment {
  appointmentId: string
  clientName:    string
  serviceName:   string
  date:          string       // YYYY-MM-DD
  time:          string       // HH:mm
  setAt:         number       // epoch ms — used to age out stale references
}

export interface VoiceSession {
  messages: SessionMessage[]
  lastRef?: LastReferencedAppointment | null
}

const SESSION_TTL     = 60 * 30                  // 30 min
const LAST_REF_TTL_MS = 10 * 60 * 1000           // 10 min

const sessionKey = (userId: string) => `ai:session:${userId}`

/** Drops a lastRef older than LAST_REF_TTL_MS so we don't act on stale state. */
export function pruneStaleRef(
  ref: LastReferencedAppointment | null | undefined,
): LastReferencedAppointment | null {
  if (!ref) return null
  if (typeof ref.setAt !== 'number') return null
  if (Date.now() - ref.setAt > LAST_REF_TTL_MS) return null
  return ref
}

/**
 * Loads the session via cascade:
 *   Redis (server-side truth) → client-supplied fallback → empty
 *
 * Returns the source as well so the caller can log which path was hit;
 * useful when diagnosing "the agent forgot what we just said" reports.
 */
export async function loadSession(
  userId:         string,
  clientFallback: SessionMessage[],
): Promise<{ session: VoiceSession; source: 'redis' | 'client' | 'empty' }> {
  const raw = await redisGet(sessionKey(userId))
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<VoiceSession>
      if (parsed.messages && parsed.messages.length > 0) {
        return {
          session: {
            messages: parsed.messages,
            lastRef:  pruneStaleRef(parsed.lastRef),
          },
          source: 'redis',
        }
      }
    } catch {
      /* fall through to client fallback */
    }
  }

  if (clientFallback.length > 0) {
    return {
      session: { messages: clientFallback, lastRef: null },
      source:  'client',
    }
  }
  return { session: { messages: [], lastRef: null }, source: 'empty' }
}

export async function saveSession(userId: string, session: VoiceSession): Promise<void> {
  const payload: VoiceSession = {
    messages: session.messages.slice(-30),
    lastRef:  pruneStaleRef(session.lastRef) ?? null,
  }
  await redisSet(sessionKey(userId), JSON.stringify(payload), SESSION_TTL)
}

/** Marks the appointment as the implicit subject of follow-up turns. */
export function withLastRef(
  session: VoiceSession,
  ref:     Omit<LastReferencedAppointment, 'setAt'>,
): VoiceSession {
  return {
    ...session,
    lastRef: { ...ref, setAt: Date.now() },
  }
}
