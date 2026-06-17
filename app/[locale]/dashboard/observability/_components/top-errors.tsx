import { getTranslations } from 'next-intl/server'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ErrorBucket } from '../_data/observability-repo'

interface Props {
  errors: ReadonlyArray<ErrorBucket>
}

export async function TopErrors({ errors }: Props) {
  const t = await getTranslations('observability')

  if (errors.length === 0) {
    return (
      <Card className="p-6">
        <CardHeader><CardTitle>{t('topErrorsTitle')}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('topErrorsEmpty')}</p>
        </CardContent>
      </Card>
    )
  }

  const max = Math.max(...errors.map((e) => e.count))

  return (
    <Card className="p-6">
      <CardHeader><CardTitle>{t('topErrorsTitlePeriod')}</CardTitle></CardHeader>
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
