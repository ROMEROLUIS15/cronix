'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import {
  incrementLoginFailures,
  resetLoginFailures,
  getLoginFailures,
} from '@/lib/rate-limit/redis-rate-limiter'

// Lockout policy constants
const MAX_ATTEMPTS_BEFORE_LOCK = 3          // lock after 3 consecutive failures
const LOCKOUT_DURATION_MS = 5 * 60 * 1000  // 5 minutes
const EXTENDED_LOCKOUT_MS  = 15 * 60 * 1000 // 15 min after 6+ attempts

export type LoginResult =
  | { error: string; failedAttempts?: number; lockoutEndsAt?: number }
  | undefined

export async function login(formData: FormData): Promise<LoginResult> {
  const email    = (formData.get('email') as string | null) ?? ''
  const password = (formData.get('password') as string | null) ?? ''

  const supabase = await createClient()

  // 1. Check Redis rate limit (fast cache layer)
  const existing = await getLoginFailures(email)
  if (existing && existing.count >= MAX_ATTEMPTS_BEFORE_LOCK) {
    const lockDuration = existing.count >= 6 ? EXTENDED_LOCKOUT_MS : LOCKOUT_DURATION_MS
    const lockoutEndsAt = existing.lastFailAt + lockDuration
    if (Date.now() < lockoutEndsAt) {
      // Also record in PostgreSQL for audit trail
      await supabase.rpc('fn_record_failed_password_attempt', { p_email: email })

      return {
        error: 'locked',
        failedAttempts: existing.count,
        lockoutEndsAt,
      }
    }
  }

  // 2. Check PostgreSQL rate limit (persistent DB check)
  const { data: dbCheckResult, error: dbCheckError } = await supabase.rpc(
    'fn_check_password_attempts',
    { p_email: email }
  )

  if (dbCheckError) {
    console.error('DB password check failed:', dbCheckError)
    // Continue anyway; don't block login on DB error
  } else if (dbCheckResult && !dbCheckResult.allowed) {
    return {
      error: 'locked',
      failedAttempts: dbCheckResult.attempt_count,
      lockoutEndsAt: dbCheckResult.locked_until ? new Date(dbCheckResult.locked_until).getTime() : undefined,
    }
  }

  // 3. Attempt password authentication
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const msg = error.message.toLowerCase()

    if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      return {
        error: 'Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.',
      }
    }

    // 4. Credential failure — increment BOTH counters (Redis + PostgreSQL)
    const redisState = await incrementLoginFailures(email)

    // Record in PostgreSQL for persistent audit
    const { data: dbRecordResult } = await supabase.rpc(
      'fn_record_failed_password_attempt',
      { p_email: email }
    )

    const isNowLocked = redisState.count >= MAX_ATTEMPTS_BEFORE_LOCK
    const lockDuration = redisState.count >= 6 ? EXTENDED_LOCKOUT_MS : LOCKOUT_DURATION_MS

    return {
      error: isNowLocked ? 'locked' : 'invalid_credentials',
      failedAttempts: redisState.count,
      lockoutEndsAt: isNowLocked ? redisState.lastFailAt + lockDuration : undefined,
    }
  }

  // 5. Success — clear BOTH counters (Redis + PostgreSQL)
  await resetLoginFailures(email)

  const { error: resetError } = await supabase.rpc(
    'fn_reset_password_attempts',
    { p_email: email }
  )

  if (resetError) {
    console.error('Failed to reset DB password attempts:', resetError)
    // Don't block login on this error
  }

  redirect('/dashboard')
}


/**
 * Google OAuth — LOGIN only.
 * Unregistered users are blocked in /auth/callback.
 */
export async function signInWithGoogle() {
  const supabase = await createClient()
  const origin   = (await headers()).get('origin')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:  `${origin}/auth/callback?next=/dashboard`,
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) return { error: error.message }
  if (data.url) redirect(data.url)
  return { error: 'No se pudo generar el enlace de Google.' }
}

/**
 * Google OAuth — REGISTER only.
 * intent=signup tells /auth/callback to create the user in public.users.
 */
export async function signUpWithGoogle() {
  const supabase = await createClient()
  const origin   = (await headers()).get('origin')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:  `${origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) return { error: error.message }
  if (data.url) redirect(data.url)
  return { error: 'No se pudo generar el enlace de Google.' }
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
