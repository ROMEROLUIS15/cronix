import { createClient } from "@/lib/supabase/server"
import { getAuthUser, getAuthUserProfile } from "@/lib/supabase/server-cache"
import { getRepos } from "@/lib/repositories"
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns"
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

  // Pre-compute the same range useDashboardData computes on the client so the
  // SSR-fetched rows match the exact React Query key and seed initialData
  // without a re-fetch on hydration.
  const now = new Date()
  const todayStr      = format(now, 'yyyy-MM-dd')
  const monthStartStr = format(startOfMonth(now), 'yyyy-MM-dd')
  const rangeStart    = format(startOfWeek(startOfMonth(now), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const rangeEnd      = format(endOfWeek(endOfMonth(now),     { weekStartsOn: 1 }), 'yyyy-MM-dd')

  // Three parallel reads. The month-appointments fetch used to live entirely on
  // the client (calendar appeared empty until React Query resolved); pulling it
  // server-side means the first paint already shows the full grid.
  const [statsResult, servicesResult, apptsResult] = await Promise.all([
    repos.appointments.getDashboardStats(businessId, todayStr, monthStartStr),
    repos.services.hasAny(businessId),
    repos.appointments.getMonthAppointments(businessId, rangeStart, rangeEnd),
  ])

  const stats        = statsResult.data    ?? { todayCount: 0, totalClients: 0, monthRevenue: 0, pending: 0 }
  const hasServices  = servicesResult.data ?? false
  const monthApts    = apptsResult.data    ?? []

  return (
    <DashboardClient
      initialStats={stats}
      initialHasServices={hasServices}
      initialMonthApts={monthApts}
      initialRangeStart={rangeStart}
      initialRangeEnd={rangeEnd}
      userName={userName}
    />
  )
}
