import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ErrorBucket } from '../_data/observability-repo'

interface Props {
  errors: ReadonlyArray<ErrorBucket>
}

export function TopErrors({ errors }: Props) {
  if (errors.length === 0) {
    return (
      <Card className="p-6">
        <CardHeader><CardTitle>Errores más frecuentes</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Sin errores en las últimas 24 horas.</p>
        </CardContent>
      </Card>
    )
  }

  const max = Math.max(...errors.map((e) => e.count))

  return (
    <Card className="p-6">
      <CardHeader><CardTitle>Errores más frecuentes (24h)</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {errors.map((e) => (
            <li key={e.code} className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground w-44 truncate" title={e.code}>
                {e.code}
              </span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-danger"
                  style={{ width: `${(e.count / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-bold w-8 text-right">{e.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
