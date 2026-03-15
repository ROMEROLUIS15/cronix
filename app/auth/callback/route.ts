import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { EmailOtpType, User } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export async function GET(request: Request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url)
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? requestOrigin
  const next     = searchParams.get('next') ?? '/dashboard'
  const isSignup = searchParams.get('intent') === 'signup'
  const supabase = await createClient()

  // ── OAuth PKCE flow ───────────────────────────────────────────────────────
  const code = searchParams.get('code')
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      if (isSignup) {
        await handleGoogleSignup(data.user)
        return NextResponse.redirect(`${siteUrl}/dashboard/setup`)
      }
      const result = await handleUserSession(data.user)
      if (result === 'not_registered') {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${siteUrl}/register?error=google_not_registered`)
      }
      return NextResponse.redirect(`${siteUrl}${next}`)
    }
    return NextResponse.redirect(`${siteUrl}/login?error=auth_failed`)
  }

  // ── Email OTP / token_hash flow ───────────────────────────────────────────
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type') as EmailOtpType | null
  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type })
    if (!error && data.user) {
      return NextResponse.redirect(`${siteUrl}${next}`)
    }
    return NextResponse.redirect(`${siteUrl}/login?error=email_confirmation_failed`)
  }

  return NextResponse.redirect(`${siteUrl}/login?error=auth_failed`)
}

type SessionResult = 'ok' | 'not_registered'

/**
 * LOGIN flow: verify the Google user exists in our DB.
 * If not → hard-delete from auth.users and block access.
 */
async function handleUserSession(user: User): Promise<SessionResult> {
  const admin = createAdminClient()

  const { data: dbUser } = await admin
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (dbUser) return 'ok'

  const provider = user.app_metadata?.provider as string | undefined
  if (provider === 'email') return 'ok'

  // Not registered via OAuth → hard-delete so retry is also blocked
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[auth/callback] Failed to delete unregistered OAuth user:', deleteError.message)
  }

  return 'not_registered'
}

/**
 * REGISTER flow: insert new Google user into public.users.
 * The trigger is blocked for OAuth providers, so we insert manually.
 * business_id stays null until /dashboard/setup completes.
 */
async function handleGoogleSignup(user: User): Promise<void> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) return

  const fullName = user.user_metadata?.full_name as string | undefined
  const email    = user.email ?? ''
  const name     = fullName || email.split('@')[0] || 'Usuario'

  await admin.from('users').insert({
    id:          user.id,
    email,
    name,
    role:        'owner' as Database['public']['Enums']['user_role'],
    business_id: null,
  })
}