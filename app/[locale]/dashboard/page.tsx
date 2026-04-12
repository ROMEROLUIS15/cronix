import { createClient } from "@/lib/supabase/server"
import { getRepos } from "@/lib/repositories"
import { DashboardClient } from "./_client/dashboard-client"

/**
 * DashboardPage — Server Component (RSC).
 *
 * Fetches initial data server-side so the HTML arrives pre-rendered.
 * Hydration then activates the client layer for interactivity.
 */
export default async function DashboardPage() {
  // This runs on the server — we need to get the business context
  // The layout already sets up ServerBusinessContextProvider, but we're
  // inside it so we can access it via a server-side equivalent.
  // Since this is an RSC, we fetch directly from Supabase server client.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <DashboardClient
        initialStats={{ todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }}
        initialHasServices={false}
        userName="Usuario"
      />
    )
  }

  // Get user + business data
  const { data: dbUser } = await supabase
    .from('users')
    .select('name, business_id')
    .eq('id', user.id)
    .single()

  if (!dbUser?.business_id) {
    return (
      <DashboardClient
        initialStats={{ todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }}
        initialHasServices={false}
        userName={dbUser?.name ?? "Usuario"}
      />
    )
  }

  const repos = getRepos(supabase)
  const businessId = dbUser.business_id
  const userName = dbUser.name

  // Fetch lightweight initial data in parallel (React Query handles appointments on client)
  const todayStr = new Date().toISOString().slice(0, 10)
  const monthStartStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`

  const [statsResult, servicesResult] = await Promise.all([
    repos.appointments.getDashboardStats(businessId, todayStr, monthStartStr),
    repos.services.hasAny(businessId),
  ])

  const stats = statsResult.data ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }
  const hasServices = servicesResult.data ?? false

  return (
    <DashboardClient
      initialStats={stats}
      initialHasServices={hasServices}
      userName={userName}
    />
  )
}
