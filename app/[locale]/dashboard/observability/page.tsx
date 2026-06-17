/**
 * Observability dashboard — per-tenant view.
 *
 * Server component. Reads ai_traces via the regular Supabase client; RLS
 * filters automatically to the caller's business. No client-side JS.
 */

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getCachedSessionUser, getCachedUserProfile } from '@/lib/supabase/server-cache'
import { ObservabilityRepo } from './_data/observability-repo'
import { SummaryCards }      from './_components/summary-cards'
import { TopErrors }         from './_components/top-errors'
import { RecentTraces }      from './_components/recent-traces'

// Always render fresh — observability data is by definition live.
export const dynamic = 'force-dynamic'

export default async function ObservabilityPage() {
  const user = await getCachedSessionUser()
  if (!user) redirect('/login')

  const profile = await getCachedUserProfile(user.id)
  if (!profile?.business_id) redirect('/dashboard/setup')

  const business = !Array.isArray(profile.businesses) ? profile.businesses : null
  const timezone = (business as { timezone?: string | null } | null)?.timezone ?? 'America/Bogota'

  const t = await getTranslations('observability')
  const supabase = await createClient()
  const repo     = new ObservabilityRepo(supabase)

  const [summary, topErrors, recentTraces] = await Promise.all([
    repo.getSummary24h(profile.business_id),
    repo.getTopErrors24h(profile.business_id),
    repo.getRecentTraces(profile.business_id),
  ])

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </header>

      <SummaryCards summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopErrors    errors={topErrors} />
        <RecentTraces traces={recentTraces} timezone={timezone} />
      </div>
    </div>
  )
}
