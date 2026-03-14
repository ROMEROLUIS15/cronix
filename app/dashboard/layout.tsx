import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { SessionTimeout } from '@/components/session-timeout'

interface DashboardLayoutProps { children: React.ReactNode }

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient()

  // ── Auth check (server-side, no round trip) ───────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Single parallel query: user + business in one join ────────────────────
  const { data: dbUser } = await supabase
    .from('users')
    .select('name, role, business_id, avatar_url, color, businesses(name, category)')
    .eq('id', user.id)
    .single()

  // ── Onboarding gate ───────────────────────────────────────────────────────
  // Users without a business (new signups via email or Google) must complete
  // setup before accessing any dashboard page. Exclude /setup itself.
  const headersList = await headers()
  const pathname    = headersList.get('x-invoke-path') ?? headersList.get('x-pathname') ?? ''
  const isSetupPage = pathname.includes('/setup')

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