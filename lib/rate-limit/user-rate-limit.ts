/**
 * user-rate-limit.ts — Per-user rate limiting for authenticated, cost-incurring
 * API routes.
 *
 * The middleware chain (`withRateLimit`) enforces a coarse per-IP cap on `/api/*`,
 * but `/api/assistant/*` is deliberately bypassed there for latency — and each of
 * those endpoints spends real money (Groq LLM, Deepgram TTS) or writes telemetry.
 * This enforces a tight cap keyed on the authenticated user id, reusing the same
 * Redis sliding-window limiter.
 *
 * Fail-open: when Redis is unconfigured or down, `redisRateLimit` allows the
 * request, so a Redis outage never blocks the assistant.
 */

import { NextResponse } from 'next/server'
import { redisRateLimit } from './redis-rate-limiter'

export interface UserRateLimit {
  /** Distinct action bucket — each gets its own sliding window. */
  readonly action: string
  /** Max requests allowed within the window. */
  readonly limit: number
  /** Window length in seconds. */
  readonly windowSecs: number
}

/**
 * Tuned per-user budgets for the assistant cost endpoints. Generous enough for a
 * real voice conversation (many TTS calls per session) yet low enough that a
 * hammering script trips 429 within seconds instead of burning provider quota.
 */
export const ASSISTANT_LIMITS = {
  proactive:  { action: 'assistant-proactive', limit: 15, windowSecs: 60 },
  tts:        { action: 'assistant-tts',        limit: 90, windowSecs: 60 },
  ttsFailure: { action: 'assistant-tts-fail',   limit: 60, windowSecs: 60 },
} as const satisfies Record<string, UserRateLimit>

/**
 * Returns true when the user is over budget for this action. Use where the caller
 * needs to react without a 429 body (e.g. a fire-and-forget beacon that must keep
 * its 204 contract).
 */
export async function isUserRateLimited(userId: string, cfg: UserRateLimit): Promise<boolean> {
  const { allowed } = await redisRateLimit(userId, cfg.action, cfg.limit, cfg.windowSecs)
  return !allowed
}

/**
 * Enforces a per-user rate limit. Returns a 429 `NextResponse` (with `Retry-After`)
 * when the caller is over budget, or `null` when the request may proceed.
 */
export async function enforceUserRateLimit(userId: string, cfg: UserRateLimit): Promise<NextResponse | null> {
  const { allowed, retryAfter } = await redisRateLimit(userId, cfg.action, cfg.limit, cfg.windowSecs)
  if (allowed) return null

  const retry = retryAfter ?? cfg.windowSecs
  return NextResponse.json(
    { error: `Demasiadas solicitudes. Reintenta en ${retry}s.` },
    { status: 429, headers: { 'Retry-After': String(retry) } },
  )
}
