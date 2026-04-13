import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'
import { logger } from '@/lib/logger'
import type { EmailOtpType, User } from '@supabase/supabase-js'

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
  const { users: usersRepoInstance } = getRepos(admin)
  const authProvider = user.app_metadata?.provider as string | undefined
  const email = user.email ?? ''

  // 1. Check by auth ID first (normal case)
  const profileCheck = await usersRepoInstance.getUserContextById(user.id)
  const dbUser = profileCheck.data

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
    const emailCheck = await usersRepoInstance.getUserProfileByEmail(email)
    const emailUser = emailCheck.data

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
  const { users: usersRepoInstance, businesses: businessesRepoInstance } = getRepos(admin)
  const bizName     = user.user_metadata?.biz_name     as string | undefined
  const bizCategory = user.user_metadata?.biz_category as string | undefined
  const bizTimezone = user.user_metadata?.biz_timezone as string | undefined
  if (!bizName) return

  const userCtx = await usersRepoInstance.getUserContextById(user.id)
  const dbUser = userCtx.data

  if (!dbUser || dbUser.business_id) return  // already has a business

  const { data: bizData, error: bizError } = await businessesRepoInstance.create({
    name:     bizName,
    owner_id: user.id,
    category: bizCategory ?? 'General',
    timezone: bizTimezone ?? 'America/Caracas',
    plan:     'pro',
  })

  if (bizError || !bizData) {
    logger.error('auth-callback', 'Failed to auto-create business from metadata', bizError)
    return
  }

  await usersRepoInstance.linkUserToBusiness(user.id, {
    name: dbUser.name ?? user.email?.split('@')[0] ?? 'Usuario',
    business_id: bizData.id,
    role: 'owner',
    status: 'active',
  })
}

/**
 * Determines where to redirect after auth:
 *  - platform_admin → pulse (no business, special role)
 *  - Has business   → dashboard (or custom `next`)
 *  - No business    → setup wizard
 */
async function getRedirectDestination(user: User, next: string): Promise<string> {
  const admin = createAdminClient()
  const { users: usersRepoInstance } = getRepos(admin)

  const ctxResult = await usersRepoInstance.getUserContextById(user.id)
  const dbUser = ctxResult.data

  if (dbUser?.business_id || dbUser?.role === 'platform_admin') return next
  return '/dashboard/setup'
}
