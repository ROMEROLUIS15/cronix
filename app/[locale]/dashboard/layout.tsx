import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import type { BusinessSettingsJson } from '@/types'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { SessionTimeout } from '@/components/session-timeout'
import { Providers, ServerBusinessContextProvider } from '@/components/providers'
import { setSentryUser } from '@/lib/sentry'
import { VoiceAssistantFab } from '@/components/dashboard/voice-assistant-fab'

interface DashboardLayoutProps { children: React.ReactNode }

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient()

  // ── Auth check — server-side, no client round trip ────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── User profile via admin client — bypasses RLS ──────────────────────────
  // The users table has an RLS policy with infinite recursion that causes the
  // regular client query to fail (returns null) for some users, including
  // platform_admin. Since this layout runs server-side and only reads the
  // authenticated user's own row (WHERE id = user.id), the admin client is safe.
  const admin = createAdminClient()
  const { data: dbUser } = await admin
    .from('users')
    .select('name, role, business_id, avatar_url, color, businesses(name, category, settings, logo_url)')
    .eq('id', user.id)
    .single()

  const isPlatformAdmin = dbUser?.role === 'platform_admin'

  // ── Sentry: bind user + tenant context to this request ───────────────────
  if (user) {
    const businessName = dbUser?.businesses && !Array.isArray(dbUser.businesses)
      ? dbUser.businesses.name
      : null
    setSentryUser(user.id, dbUser?.business_id ?? null, businessName)
  }

  // ── Routing logic ─────────────────────────────────────────────────────────
  const headersList = await headers()
  const nextUrl     = headersList.get('next-url') ?? ''
  const isSetupPage = nextUrl.includes('/setup') || nextUrl === ''

  // Regular users without a business → onboarding
  // platform_admin bypasses this gate (no business_id by design)
  if (!dbUser?.business_id && !isSetupPage && !isPlatformAdmin) {
    redirect('/dashboard/setup')
  }

  // ── Build typed profiles for DashboardShell ───────────────────────────────
  const fallbackName = user?.email?.split('@')[0]?.replace(/[.+]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Usuario'
  const userProfile = dbUser
    ? {
        name:        dbUser.name,
        role:        dbUser.role,
        business_id: dbUser.business_id,
        avatar_url:  dbUser.avatar_url,
        color:       dbUser.color,
      }
    : {
        name:        fallbackName,
        role:        'owner' as const,
        business_id: null,
        avatar_url:  null,
        color:       null,
      }

  const rawBiz = dbUser?.businesses && !Array.isArray(dbUser.businesses)
    ? dbUser.businesses
    : null

  const businessProfile = rawBiz ? {
    name:       rawBiz.name,
    category:   rawBiz.category,
    logo_url:   rawBiz.logo_url ?? null,
    brandColor: (rawBiz.settings as BusinessSettingsJson | null)?.brandColor ?? null,
  } : null

  return (
    <Providers>
      <ServerBusinessContextProvider
        value={dbUser && user && dbUser.business_id ? {
          businessId: dbUser.business_id,
          userName: dbUser.name,
          userRole: dbUser.role ?? 'employee',
          userId: user.id,
        } : null}
      >
        <DashboardShell user={userProfile} business={businessProfile}>
          <SessionTimeout />
          {/* FAB siempre montado — visibilidad controlada internamente
              por el switch en Ajustes. No depende del rol ni del negocio. */}
          <VoiceAssistantFab />
          {children}
        </DashboardShell>
      </ServerBusinessContextProvider>
    </Providers>
  )
}
