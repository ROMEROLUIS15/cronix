import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { SessionTimeout } from '@/components/session-timeout'

interface DashboardLayoutProps { children: React.ReactNode }

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient()

  // ── Auth check — server-side, no client round trip ────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Single query: user + business via join ────────────────────────────────
  const { data: dbUser } = await supabase
    .from('users')
    .select('name, role, business_id, avatar_url, color, businesses(name, category)')
    .eq('id', user.id)
    .single()

  // ── Onboarding gate ───────────────────────────────────────────────────────
  // New users (Google or email) have business_id = null until setup completes.
  // next-url header is set by Next.js App Router for the current request path.
  const headersList  = await headers()
  const nextUrl      = headersList.get('next-url') ?? ''
  const isSetupPage  = nextUrl.includes('/setup') || nextUrl === ''

  if (!dbUser?.business_id && !isSetupPage) {
    redirect('/dashboard/setup')
  }

  const userProfile = dbUser ? {
    name:        dbUser.name,
    role:        dbUser.role,
    business_id: dbUser.business_id,
    avatar_url:  dbUser.avatar_url,
    color:       dbUser.color,
  } : null

  const businessProfile = dbUser?.businesses && !Array.isArray(dbUser.businesses)
    ? { name: dbUser.businesses.name, category: dbUser.businesses.category }
    : null

  return (
    <DashboardShell user={userProfile} business={businessProfile}>
      <SessionTimeout />
      {children}
    </DashboardShell>
  )
}