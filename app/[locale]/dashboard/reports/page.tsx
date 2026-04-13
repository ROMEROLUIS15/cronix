'use client'

import { useReportsData } from './hooks/use-reports-data'
import { ReportsView } from './reports-view'
import { Loader2 } from 'lucide-react'

export default function ReportsPage() {
  const { data, loading } = useReportsData()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="animate-spin" size={32} style={{ color: '#0062FF' }} />
      </div>
    )
  }

  if (!data) {
    return null
  }

  return <ReportsView data={data} />
}
