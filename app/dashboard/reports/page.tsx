import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessId } from '@/lib/auth/get-business-id'
import * as financesRepo from '@/lib/repositories/finances.repo'
import { ReportsView } from './reports-view'
import type { ReportData } from './reports-view'

interface ReportAppointment {
  id: string
  start_at: string
  status: string | null
  service: { name: string; price: number } | null
  client: { name: string } | null
}

export default async function ReportsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const supabase = await createClient()

  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

  const [aptsRes, clientsRes, txns, expenses] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, start_at, status, service:services(name, price), client:clients(name)')
      .eq('business_id', businessId)
      .gte('start_at', monthStart)
      .lte('start_at', monthEnd)
      .order('start_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id', { count: 'exact' })
      .eq('business_id', businessId)
      .is('deleted_at', null),
    financesRepo.getTransactions(supabase, businessId),
    financesRepo.getExpenses(supabase, businessId),
  ])

  const apts = (aptsRes.data ?? []) as ReportAppointment[]
  const monthStartDate = monthStart.split('T')[0] ?? ''
  const monthEndDate   = monthEnd.split('T')[0] ?? ''
  const monthTxns = txns.filter(t => (t.paid_at ?? '') >= monthStart && (t.paid_at ?? '') <= monthEnd)
  const monthExps = expenses.filter(e => (e.expense_date ?? '') >= monthStartDate && (e.expense_date ?? '') <= monthEndDate)

  const totalRevenue  = monthTxns.reduce((s, t) => s + (t.net_amount ?? 0), 0)
  const totalExpenses = monthExps.reduce((s, e) => s + e.amount, 0)

  const byService: Record<string, { count: number; revenue: number }> = {}
  apts.forEach(apt => {
    const name = apt.service?.name ?? 'Sin servicio'
    if (!byService[name]) byService[name] = { count: 0, revenue: 0 }
    byService[name].count++
    if (apt.status === 'completed') byService[name].revenue += apt.service?.price ?? 0
  })

  const data: ReportData = {
    totalAppointments:     apts.length,
    completedAppointments: apts.filter(a => a.status === 'completed').length,
    cancelledAppointments: apts.filter(a => a.status === 'cancelled').length,
    totalClients:          clientsRes.count ?? 0,
    totalRevenue,
    totalExpenses,
    netProfit:             totalRevenue - totalExpenses,
    byService,
    recentAppointments:    apts.slice(0, 10),
  }

  return <ReportsView data={data} />
}
