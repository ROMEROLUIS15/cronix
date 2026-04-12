import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase/server'
import { redisRateLimit, isRedisAvailable } from '@/lib/rate-limit/redis-rate-limiter'
import { generalRateLimiter } from '@/lib/api/rate-limit'

export const runtime = 'nodejs'

// Dedicated passkey rate limit: 10 attempts/min per IP (stricter than general API limit)
const PASSKEY_LIMIT = 10
const PASSKEY_WINDOW_SECS = 60

export async function POST(request: NextRequest) {
  // Rate limit — passkey-specific bucket
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? '127.0.0.1'

  if (isRedisAvailable()) {
    const result = await redisRateLimit(ip, 'passkey_auth', PASSKEY_LIMIT, PASSKEY_WINDOW_SECS)
    if (!result.allowed) {
      return NextResponse.json(
        { error: `Too many authentication attempts. Try again in ${result.retryAfter}s.` },
        { status: 429 },
      )
    }
  } else {
    const { limited, retryAfter } = generalRateLimiter.isRateLimited(ip)
    if (limited) {
      return NextResponse.json(
        { error: `Too many authentication attempts. Try again in ${retryAfter}s.` },
        { status: 429 },
      )
    }
  }

  const admin = createAdminClient()

  const host = request.headers.get('host') || 'localhost'
  const rpID = host.replace(/:\d+$/, '')

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  })

  interface PasskeyChallenge {
    id: string;
    challenge: string;
    user_id?: string;
    created_at: string;
  }

  // Store challenge without user_id (login flow — user unknown yet)
  await (admin.from('passkey_challenges') as any).insert({ challenge: options.challenge })

  return NextResponse.json(options)
}
