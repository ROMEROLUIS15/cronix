/**
 * Upstash Redis REST primitives + rate limiting.
 *
 * Required env vars (Supabase secrets):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If env vars are missing, all functions degrade silently to no-ops so the
 * voice agent still responds (just without persistence between turns).
 *
 * Session-shape concerns live in core/session.ts — this file is purely
 * transport.
 */

const REDIS_URL   = Deno.env.get('UPSTASH_REDIS_REST_URL')   ?? ''
const REDIS_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ?? ''

const RATE_LIMIT_TTL = 60   // seconds, sliding window

export const isRedisAvailable = (): boolean => Boolean(REDIS_URL && REDIS_TOKEN)

// ── Low-level primitives ───────────────────────────────────────────────────

/** GET a single key. Returns the raw string value or null. */
export async function redisGet(key: string): Promise<string | null> {
  if (!isRedisAvailable()) return null
  try {
    const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    })
    if (!res.ok) return null
    const json = await res.json() as { result: string | null }
    return json.result ?? null
  } catch {
    return null
  }
}

/**
 * SET via Upstash pipeline-style POST. The previous path-encoded GET
 * (/set/{k}/{v}) silently dropped writes once the encoded JSON exceeded
 * the URL length limit (~5KB after percent-encoding). POSTing the command
 * array keeps the value in the request body where Upstash accepts payloads
 * up to 1MB.
 */
export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!isRedisAvailable()) return
  try {
    await fetch(`${REDIS_URL}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, value, 'EX', ttlSeconds]),
    })
  } catch {
    /* silent — session loss is non-critical */
  }
}

// ── Rate limiting (sliding window via INCR + EX) ───────────────────────────

export async function checkRateLimit(
  userId:    string,
  maxPerMin: number = 30,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!isRedisAvailable()) return { allowed: true, retryAfter: 0 }

  const key = `rl:voice:${userId}`
  try {
    const incrRes = await fetch(`${REDIS_URL}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    })
    if (!incrRes.ok) return { allowed: true, retryAfter: 0 }
    const incrJson = await incrRes.json() as { result: number }
    const count = incrJson.result

    if (count === 1) {
      await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${RATE_LIMIT_TTL}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      })
    }

    if (count > maxPerMin) {
      const ttlRes = await fetch(`${REDIS_URL}/ttl/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      })
      const ttlJson = ttlRes.ok ? await ttlRes.json() as { result: number } : null
      return { allowed: false, retryAfter: ttlJson?.result ?? RATE_LIMIT_TTL }
    }

    return { allowed: true, retryAfter: 0 }
  } catch {
    return { allowed: true, retryAfter: 0 }
  }
}
