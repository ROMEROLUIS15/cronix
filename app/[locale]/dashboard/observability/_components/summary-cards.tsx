import { getTranslations, getLocale } from 'next-intl/server'
import { StatCard } from '@/components/ui/card'
import { Activity, CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import type { ObservabilitySummary } from '../_data/observability-repo'

interface Props {
  summary: ObservabilitySummary
}

export async function SummaryCards({ summary }: Props) {
  const t = await getTranslations('observability')
  const locale = await getLocale()
  const successRate = summary.total > 0
    ? Math.round((summary.success / summary.total) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        title={t('turns')}
        value={summary.total}
        subtitle={t('turnsSubtitle', { count: summary.success })}
        icon={<Activity className="h-5 w-5" />}
      />
      <StatCard
        title={t('successRate')}
        value={`${successRate}%`}
        subtitle={t('successRateSubtitle', { count: summary.failures })}
        icon={<CheckCircle2 className="h-5 w-5" />}
        accent={successRate >= 80}
      />
      <StatCard
        title={t('tokens')}
        value={summary.tokens.toLocaleString(locale)}
        subtitle={t('tokensSubtitle')}
        icon={<Zap className="h-5 w-5" />}
      />
      <StatCard
        title={t('latencyP95')}
        value={`${(summary.p95Ms / 1000).toFixed(1)}s`}
        subtitle={t('latencyP50Subtitle', { value: (summary.p50Ms / 1000).toFixed(1) })}
        icon={<AlertTriangle className="h-5 w-5" />}
      />
    </div>
  )
}
