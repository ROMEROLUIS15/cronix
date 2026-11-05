import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRedis, redisRateLimit } from '@/lib/rate-limit/redis-rate-limiter'
import { getClientIP } from '@/lib/middleware/utils'
import { parsePwaLoadReport, storePwaLoad } from '@/lib/pwa/load-metrics'
import { logger } from '@/lib/logger'

const NO_CONTENT = () => new NextResponse(null, { status: 204 })

/**
 * POST /api/pwa/load — receives the load beacon of lib/pwa/load-beacon-script.ts.
 *
 * Anonymous on purpose: an open that lands on /login after iOS dropped the session
 * must be measured too. The business comes from the session when there is one, never
 * from the body. Fire-and-forget: always 204, and nothing is stored outside production,
 * so local runs never write into the production Redis.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL_ENV !== 'production') return NO_CONTENT()
  const redis = getRedis()
  if (!redis) return NO_CONTENT()

  const report = parsePwaLoadReport(await req.text().catch(() => ''))
  if (!report) return NO_CONTENT()

  const { allowed } = await redisRateLimit(getClientIP(req), 'pwa-load', 30, 60)
  if (!allowed) return NO_CONTENT()

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    let businessId: string | null = null
    if (user) {
      const { data: profile } = await supabase.from('users').select('business_id').eq('id', user.id).single()
      businessId = profile?.business_id ?? null
    }
    await storePwaLoad(redis, {
      ...report,
      at: new Date().toISOString(),
      businessId,
      ua: (req.headers.get('user-agent') ?? '').slice(0, 250),
    })
  } catch (err) {
    logger.error('PWA-LOAD-BEACON', 'failed to record a load report', err)
  }
  return NO_CONTENT()
}
