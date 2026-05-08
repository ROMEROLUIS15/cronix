/**
 * Upstash Redis REST client + session storage for the voice-worker.
 *
 * Uses the same Redis instance as the rest of the app (Vercel-side already
 * uses Upstash). Identical key namespaces so the two paths stay consistent.
 *
 * Required env vars (Supabase secrets):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If env vars are missing, all functions degrade silently to no-ops so the
 * voice agent still responds (just without persistence between turns).
 */

const REDIS_URL   = Deno.env.get('UPSTASH_REDIS_REST_URL')   ?? ''
const REDIS_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ?? ''

const SESSION_TTL = 60 * 30 // 30 minutes — matches the legacy Vercel session-store
const RATE_LIMIT_TTL = 60   // 60 seconds for sliding window

export const isRedisAvailable = (): boolean => Boolean(REDIS_URL && REDIS_TOKEN)

// ── Low-level REST helpers ─────────────────────────────────────────────────

async function redisFetch<T>(path: string[]): Promise<T | null> {
  if (!isRedisAvailable()) return null
  try {
    const res = await fetch(`${REDIS_URL}/${path.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    })
    if (!res.ok) return null
    const json = await res.json() as { result: T }
    return json.result
  } catch {
    return null
  }
}

async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!isRedisAvailable()) return
  try {
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    })
  } catch {
    /* silent — session loss is non-critical */
  }
}

// ── Session storage ────────────────────────────────────────────────────────

interface Session {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

const sessionKey = (userId: string) => `ai:session:${userId}`

export async function getSession(userId: string): Promise<Session> {
  const raw = await redisFetch<string>(['get', sessionKey(userId)])
  if (!raw) return { messages: [] }
  try {
    const parsed = JSON.parse(raw) as Session
    return parsed.messages ? parsed : { messages: [] }
  } catch {
    return { messages: [] }
  }
}

export async function saveSession(userId: string, session: Session): Promise<void> {
  // Cap history to last 30 turns to bound prompt size.
  const trimmed: Session = { messages: session.messages.slice(-30) }
  await redisSet(sessionKey(userId), JSON.stringify(trimmed), SESSION_TTL)
}

// ── Rate limiting (sliding window via INCR + EX) ───────────────────────────

/**
 * Returns { allowed, retryAfter }. Uses a fixed 60-second window with a per-user
 * counter. Same algorithm as Vercel-side `redisRateLimit`, kept simple here.
 */
export async function checkRateLimit(
  userId:    string,
  maxPerMin: number = 30,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!isRedisAvailable()) return { allowed: true, retryAfter: 0 }

  const key = `rl:voice:${userId}`
  try {
    // INCR returns the new count
    const incrRes = await fetch(`${REDIS_URL}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    })
    if (!incrRes.ok) return { allowed: true, retryAfter: 0 }
    const incrJson = await incrRes.json() as { result: number }
    const count = incrJson.result

    // First hit → set expiry
    if (count === 1) {
      await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${RATE_LIMIT_TTL}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      })
    }

    if (count > maxPerMin) {
      // Read TTL for retry hint
      const ttlRes = await fetch(`${REDIS_URL}/ttl/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      })
      const ttlJson = ttlRes.ok ? await ttlRes.json() as { result: number } : null
      return { allowed: false, retryAfter: ttlJson?.result ?? RATE_LIMIT_TTL }
    }

    return { allowed: true, retryAfter: 0 }
  } catch {
    // Fail open — Redis blip should not block the user
    return { allowed: true, retryAfter: 0 }
  }
}
