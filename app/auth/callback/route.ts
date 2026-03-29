import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { EmailOtpType, User } from '@supabase/supabase-js'
import { generateBusinessSlug } from '@/lib/repositories/businesses.repo'

export async function GET(request: Request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url)
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? requestOrigin
  const next     = searchParams.get('next') ?? '/dashboard'
  const supabase = await createClient()

  // ── OAuth PKCE flow (Google) ──────────────────────────────────────────────
  const code = searchParams.get('code')
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await ensureUserProfile(data.user)
      await ensureBusinessFromMetadata(data.user)
      const destination = await getRedirectDestination(data.user, next)
      return NextResponse.redirect(`${siteUrl}${destination}`)
    }
    return NextResponse.redirect(`${siteUrl}/login?error=auth_failed`)
  }

  // ── Email OTP / token_hash flow (email confirmation, magic link) ──────────
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type') as EmailOtpType | null
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (!error && data.user) {
      await ensureUserProfile(data.user)
      await ensureBusinessFromMetadata(data.user)
      const destination = await getRedirectDestination(data.user, next)
      return NextResponse.redirect(`${siteUrl}${destination}`)
    }
    return NextResponse.redirect(`${siteUrl}/login?error=email_confirmation_failed`)
  }

  return NextResponse.redirect(`${siteUrl}/login?error=auth_failed`)
}

/**
 * Ensures the user has a row in public.users.
 *
 * The DB trigger `on_auth_user_created` handles this for new users.
 * This is a safety net for:
 *  - Users created before the trigger existed
 *  - Account linking (email user logs in with Google → update provider to 'hybrid')
 */
async function ensureUserProfile(user: User): Promise<void> {
  const admin = createAdminClient()
  const authProvider = user.app_metadata?.provider as string | undefined
  const email = user.email ?? ''

  // 1. Check by auth ID first (normal case)
  const { data: dbUser } = await admin
    .from('users')
    .select('id, provider')
    .eq('id', user.id)
    .maybeSingle()

  if (dbUser) {
    // Account linking: email user now also has Google → mark as hybrid
    if (dbUser.provider === 'email' && authProvider === 'google') {
      await admin.from('users')
        .update({ provider: 'hybrid' })
        .eq('id', user.id)
    }
    return
  }

  // 2. Check by email — handles identity linking (same email, different auth ID)
  if (email) {
    const { data: emailUser } = await admin
      .from('users')
      .select('id, provider')
      .eq('email', email)
      .maybeSingle()

    if (emailUser) {
      // Link: update the existing row to point to the new auth ID and mark hybrid
      await admin.from('users')
        .update({
          id: user.id,
          provider: 'hybrid',
        })
        .eq('email', email)
      return
    }
  }

  // 3. No existing user — create new row (trigger safety net)
  const fullName = user.user_metadata?.full_name as string | undefined
  const name     = fullName || email.split('@')[0] || 'Usuario'
  const provider = authProvider === 'google' ? 'google' : 'email'

  await admin.from('users').insert({
    id:    user.id,
    email,
    name,
    role:     'owner',
    status:   'pending',
    provider: provider as 'email' | 'google',
    business_id: null,
  })
}

/**
 * Auto-creates the business from user_metadata set during registration.
 *
 * During signUp, register/actions.ts stores `biz_name` in user_metadata.
 * On email confirmation this fires and creates the business + links the user,
 * so the user lands on /dashboard instead of being redirected to /setup.
 *
 * Idempotent: if the user already has a business, or if biz_name is absent
 * (e.g. Google OAuth users), this is a no-op and setup page is shown as fallback.
 */
async function ensureBusinessFromMetadata(user: User): Promise<void> {
  const admin       = createAdminClient()
  const bizName     = user.user_metadata?.biz_name     as string | undefined
  const bizCategory = user.user_metadata?.biz_category as string | undefined
  const bizTimezone = user.user_metadata?.biz_timezone as string | undefined
  if (!bizName) return

  const { data: dbUser } = await admin
    .from('users')
    .select('id, business_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!dbUser || dbUser.business_id) return  // already has a business

  const { data: bizData, error: bizError } = await admin
    .from('businesses')
    .insert({
      name:     bizName,
      owner_id: user.id,
      category: bizCategory ?? 'General',
      timezone: bizTimezone ?? 'America/Caracas',
      plan:     'pro',
      slug:     generateBusinessSlug(bizName),
    })
    .select('id')
    .single()

  if (bizError || !bizData) {
    logger.error('auth-callback', 'Failed to auto-create business from metadata', bizError)
    return
  }

  await admin
    .from('users')
    .update({
      business_id: bizData.id,
      role:        'owner',
      status:      'active',
    })
    .eq('id', user.id)
}

/**
 * Determines where to redirect after auth:
 *  - Has business → dashboard (or custom `next`)
 *  - No business  → setup wizard
 */
async function getRedirectDestination(user: User, next: string): Promise<string> {
  const admin = createAdminClient()

  const { data: dbUser } = await admin
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .maybeSingle()

  if (dbUser?.business_id) return next
  return '/dashboard/setup'
}
