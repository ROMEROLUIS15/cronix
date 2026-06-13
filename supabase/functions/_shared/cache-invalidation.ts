/**
 * Cross-channel dashboard cache invalidation (Deno Edge Functions).
 *
 * The Next.js dashboard reads clients/appointments/stats from Upstash Redis
 * (`lib/cache.ts`, per-type TTL 120-180s). Writes happen from THREE surfaces:
 *   1. dashboard repo (Node) — invalidates its own cache.
 *   2. voice-worker (Deno)   — uses this helper.
 *   3. process-whatsapp (Deno) — uses this helper.
 *
 * Surfaces 2 and 3 write straight to Postgres and never pass through the Node
 * repo, so without this the dashboard showed stale data for up to one TTL after
 * any voice/WhatsApp action. This is the single shared seam for that concern —
 * both Deno functions invalidate through here so the responsibility lives in one
 * place, not copy-pasted per channel.
 *
 * MUST mirror lib/cache.ts key format: `v1:cache:{businessId}:{dataType}:*`
 * (CACHE_VERSION 'v1'). If that version or the dataType names change in
 * lib/cache.ts, update CACHE_VERSION / DATATYPES here too.
 *
 * Fire-and-forget; silent on failure — a stale cache still self-heals via TTL,
 * so cache busting must never break a write turn.
 */

const REDIS_URL   = Deno.env.get('UPSTASH_REDIS_REST_URL')   ?? ''
const REDIS_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ?? ''

const CACHE_VERSION = 'v1'
const DATATYPES = ['clients', 'appointments', 'dashboard'] as const

async function redisCommand(command: unknown[]): Promise<unknown> {
  const res = await fetch(`${REDIS_URL}/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!res.ok) return null
  const json = await res.json() as { result?: unknown }
  return json.result ?? null
}

export async function invalidateDashboardCache(businessId: string): Promise<void> {
  if (!REDIS_URL || !REDIS_TOKEN || !businessId) return
  try {
    for (const dataType of DATATYPES) {
      const keys = await redisCommand(['KEYS', `${CACHE_VERSION}:cache:${businessId}:${dataType}:*`])
      if (Array.isArray(keys) && keys.length > 0) {
        await redisCommand(['DEL', ...keys])
      }
    }
  } catch {
    /* silent — stale cache self-heals via TTL */
  }
}
