import { getTranslations, getLocale } from 'next-intl/server'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react'
import type { TraceRow } from '../_data/observability-repo'

interface Props {
  traces:   ReadonlyArray<TraceRow>
  timezone: string
}

export async function RecentTraces({ traces, timezone }: Props) {
  const tr = await getTranslations('observability')
  const locale = await getLocale()

  const labelChannel = (c: string): string => {
    if (c === 'whatsapp')     return 'WhatsApp'
    if (c === 'dashboard')    return 'Dashboard'
    if (c === 'voice-worker') return tr('channelVoice')
    return c
  }

  const labelOutcome = (o: string): string => {
    const map: Record<string, string> = {
      success:      tr('outcomeSuccess'),
      failure:      tr('outcomeFailure'),
      error:        tr('outcomeError'),
      rate_limited: tr('outcomeRateLimited'),
      no_action:    tr('outcomeNoAction'),
    }
    return map[o] ?? o
  }

  const formatRelative = (iso: string): string => {
    const created = new Date(iso).getTime()
    const mins    = Math.floor((Date.now() - created) / 60_000)
    if (mins < 1)  return tr('relativeJustNow')
    if (mins < 60) return tr('relativeMinutes', { mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return tr('relativeHours', { hours })
    return new Date(iso).toLocaleString(locale, { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  if (traces.length === 0) {
    return (
      <Card className="p-6">
        <CardHeader><CardTitle>{tr('recentTitle')}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{tr('recentEmpty')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <CardHeader><CardTitle>{tr('recentTitle')}</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {traces.map((t) => (
            <li key={t.id} className="py-2.5 grid grid-cols-[20px_1fr_auto_auto] items-center gap-3">
              <OutcomeIcon outcome={t.outcome} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {labelChannel(t.channel)} · {labelOutcome(t.outcome)}
                  {t.toolsCount > 0 && <span className="text-muted-foreground"> · {tr('tools', { count: t.toolsCount })}</span>}
                </p>
                {t.errorCode && (
                  <p className="text-xs font-mono text-danger truncate">{t.errorCode}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {(t.latencyMs / 1000).toFixed(1)}s
              </span>
              <span className="text-xs text-muted-foreground tabular-nums" title={t.createdAt}>
                {formatRelative(t.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function OutcomeIcon({ outcome }: { outcome: string }) {
  switch (outcome) {
    case 'success':      return <CheckCircle2 className="h-4 w-4 text-success" />
    case 'failure':
    case 'error':        return <XCircle      className="h-4 w-4 text-danger" />
    case 'rate_limited': return <Clock        className="h-4 w-4 text-warning" />
    default:             return <AlertCircle  className="h-4 w-4 text-muted-foreground" />
  }
}
