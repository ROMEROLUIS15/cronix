import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react'
import type { TraceRow } from '../_data/observability-repo'

interface Props {
  traces:   ReadonlyArray<TraceRow>
  timezone: string
}

export function RecentTraces({ traces, timezone }: Props) {
  if (traces.length === 0) {
    return (
      <Card className="p-6">
        <CardHeader><CardTitle>Últimos turnos del agente</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aún no hay conversaciones registradas. Cuando un cliente le hable al agente, los turnos aparecerán aquí.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <CardHeader><CardTitle>Últimos turnos del agente</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {traces.map((t) => (
            <li key={t.id} className="py-2.5 grid grid-cols-[20px_1fr_auto_auto] items-center gap-3">
              <OutcomeIcon outcome={t.outcome} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {labelChannel(t.channel)} · {labelOutcome(t.outcome)}
                  {t.toolsCount > 0 && <span className="text-muted-foreground"> · {t.toolsCount} tool{t.toolsCount > 1 ? 's' : ''}</span>}
                </p>
                {t.errorCode && (
                  <p className="text-xs font-mono text-danger truncate">{t.errorCode}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {(t.latencyMs / 1000).toFixed(1)}s
              </span>
              <span className="text-xs text-muted-foreground tabular-nums" title={t.createdAt}>
                {formatRelative(t.createdAt, timezone)}
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

function labelChannel(c: string): string {
  if (c === 'whatsapp')     return 'WhatsApp'
  if (c === 'dashboard')    return 'Dashboard'
  if (c === 'voice-worker') return 'Voz'
  return c
}

function labelOutcome(o: string): string {
  const map: Record<string, string> = {
    success:      'éxito',
    failure:      'falló',
    error:        'error',
    rate_limited: 'rate limit',
    no_action:    'sin acción',
  }
  return map[o] ?? o
}

function formatRelative(iso: string, timezone: string): string {
  const created = new Date(iso).getTime()
  const diffMs  = Date.now() - created
  const mins    = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'hace un momento'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  return new Date(iso).toLocaleString('es-CO', { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
