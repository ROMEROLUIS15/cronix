import { StatCard } from '@/components/ui/card'
import { Activity, CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import type { ObservabilitySummary } from '../_data/observability-repo'

interface Props {
  summary: ObservabilitySummary
}

export function SummaryCards({ summary }: Props) {
  const successRate = summary.total > 0
    ? Math.round((summary.success / summary.total) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        title="Turnos (24h)"
        value={summary.total}
        subtitle={`${summary.success} exitosos`}
        icon={<Activity className="h-5 w-5" />}
      />
      <StatCard
        title="Tasa de éxito"
        value={`${successRate}%`}
        subtitle={`${summary.failures} fallos`}
        icon={<CheckCircle2 className="h-5 w-5" />}
        accent={successRate >= 80}
      />
      <StatCard
        title="Tokens (24h)"
        value={summary.tokens.toLocaleString('es-CO')}
        subtitle="cuota Groq diaria"
        icon={<Zap className="h-5 w-5" />}
      />
      <StatCard
        title="Latencia p95"
        value={`${(summary.p95Ms / 1000).toFixed(1)}s`}
        subtitle={`p50 ${(summary.p50Ms / 1000).toFixed(1)}s`}
        icon={<AlertTriangle className="h-5 w-5" />}
      />
    </div>
  )
}
