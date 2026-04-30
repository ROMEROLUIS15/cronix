import { createClient } from "@/lib/supabase/server"
import { getAuthUser, getAuthUserProfile } from "@/lib/supabase/server-cache"
import { getRepos } from "@/lib/repositories"
import { DashboardClient } from "./_client/dashboard-client"

/**
 * DashboardPage — Server Component (RSC).
 *
 * Fetches initial data server-side so the HTML arrives pre-rendered.
 * Hydration then activates the client layer for interactivity.
 */
export default async function DashboardPage() {
  // React.cache() deduplicates these calls — layout already ran them in the same
  // request, so no extra network round-trips happen here.
  const user = await getAuthUser()

  if (!user) {
    return (
      <DashboardClient
        initialStats={{ todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }}
        initialHasServices={false}
        userName="Usuario"
      />
    )
  }

  const dbUser = await getAuthUserProfile(user.id)

  if (!dbUser?.business_id) {
    return (
      <DashboardClient
        initialStats={{ todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }}
        initialHasServices={false}
        userName={dbUser?.name ?? "Usuario"}
      />
    )
  }

  const supabase = await createClient()
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
