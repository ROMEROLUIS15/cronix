'use client'

import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Download, Users, Calendar, DollarSign, Star } from 'lucide-react'
import { Card, StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Database } from '@/types/database.types'

type AppointmentRow = Database['public']['Tables']['appointments']['Row'] & {
  service?: { name: string; price: number } | null
  client?: { name: string } | null
}

type ExpenseRow = Database['public']['Tables']['expenses']['Row']
type TransactionRow = Database['public']['Tables']['transactions']['Row']

interface ReportData {
  totalAppointments: number
  completedAppointments: number
  cancelledAppointments: number
  totalClients: number
  totalRevenue: number
  totalExpenses: number
  netProfit: number
  byService: Record<string, { count: number; revenue: number }>
  recentAppointments: AppointmentRow[]
}

export default function ReportsPage() {
  const supabase = createClient()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: dbUser } = await supabase
        .from('users').select('business_id').eq('id', user.id).single()
      if (!dbUser?.business_id) { setLoading(false); return }

      const bId = dbUser.business_id

      // Get current month range
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

      const [aptsRes, clientsRes, txnsRes, expensesRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*, service:services(name, price), client:clients(name)')
          .eq('business_id', bId)
          .gte('start_at', monthStart)
          .lte('start_at', monthEnd)
          .order('start_at', { ascending: false }),
        supabase
          .from('clients')
          .select('id', { count: 'exact' })
          .eq('business_id', bId)
          .is('deleted_at', null),
        supabase
          .from('transactions')
          .select('net_amount, amount')
          .eq('business_id', bId)
          .gte('paid_at', monthStart)
          .lte('paid_at', monthEnd),
        supabase
          .from('expenses')
          .select('amount')
          .eq('business_id', bId)
          .gte('expense_date', monthStart.split('T')[0])
          .lte('expense_date', monthEnd.split('T')[0]),
      ])

      const apts = (aptsRes.data ?? []) as AppointmentRow[]
      const totalRevenue = (txnsRes.data ?? []).reduce((s, t) => s + (t.net_amount ?? 0), 0)
      const totalExpenses = (expensesRes.data ?? []).reduce((s, e) => s + e.amount, 0)

      // Group by service
      const byService: Record<string, { count: number; revenue: number }> = {}
      apts.forEach(apt => {
        const name = apt.service?.name ?? 'Sin servicio'
        if (!byService[name]) byService[name] = { count: 0, revenue: 0 }
        byService[name].count++
        if (apt.status === 'completed') byService[name].revenue += apt.service?.price ?? 0
      })

      setData({
        totalAppointments:    apts.length,
        completedAppointments: apts.filter(a => a.status === 'completed').length,
        cancelledAppointments: apts.filter(a => a.status === 'cancelled').length,
        totalClients:         clientsRes.count ?? 0,
        totalRevenue,
        totalExpenses,
        netProfit:            totalRevenue - totalExpenses,
        byService,
        recentAppointments:   apts.slice(0, 10),
      })
      setLoading(false)
    }
    loadData()
  }, [])

  const handleDownloadPDF = () => {
    if (!data) return
    const lines = [
      'REPORTE MENSUAL - AGENDO',
      '========================',
      '',
      `Citas totales: ${data.totalAppointments}`,
      `Citas completadas: ${data.completedAppointments}`,
      `Citas canceladas: ${data.cancelledAppointments}`,
      `Total clientes: ${data.totalClients}`,
      '',
      `Ingresos del mes: ${formatCurrency(data.totalRevenue)}`,
      `Gastos del mes: ${formatCurrency(data.totalExpenses)}`,
      `Ganancia neta: ${formatCurrency(data.netProfit)}`,
      '',
      'SERVICIOS MÁS POPULARES:',
      ...Object.entries(data.byService)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, { count, revenue }]) =>
          `  ${name}: ${count} citas - ${formatCurrency(revenue)}`
        ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-agendo-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reportCards = [
    {
      id: 'appointments',
      title: 'Reporte de Citas',
      sub: 'Citas por período, estado y servicio',
      period: 'Mensual', icon: '📅',
    },
    {
      id: 'finances',
      title: 'Balance Financiero',
      sub: 'Ingresos vs gastos',
      period: 'Mensual', icon: '💰',
    },
    {
      id: 'clients',
      title: 'Reporte de Clientes',
      sub: 'Total y métricas CRM',
      period: 'General', icon: '👥',
    },
    {
      id: 'services',
      title: 'Servicios Populares',
      sub: 'Ranking por frecuencia e ingresos',
      period: 'Mensual', icon: '⭐',
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reportes</h1>
          <p className="text-muted-foreground text-sm">Análisis del rendimiento de tu negocio — mes actual</p>
        </div>
        <Button leftIcon={<Download size={16} />} onClick={handleDownloadPDF}>
          Exportar reporte
        </Button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Ingresos del mes"
          value={formatCurrency(data?.totalRevenue ?? 0)}
          icon={<TrendingUp size={22} />}
          accent
        />
        <StatCard
          title="Total citas"
          value={data?.totalAppointments ?? 0}
          icon={<BarChart3 size={22} />}
        />
        <StatCard
          title="Clientes registrados"
          value={data?.totalClients ?? 0}
          icon={<Users size={22} />}
        />
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {reportCards.map(r => (
          <Card
            key={r.id}
            className={`cursor-pointer transition-all hover:border-brand-300 hover:shadow-md ${
              activeReport === r.id ? 'border-brand-500 bg-brand-50/30' : ''
            }`}
            onClick={() => setActiveReport(activeReport === r.id ? null : r.id)}
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{r.icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-foreground">{r.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.sub}</p>
                <span className="inline-block mt-2 px-2 py-0.5 bg-brand-100 text-brand-700 text-xs rounded-full">
                  {r.period}
                </span>
              </div>
              <Button
                variant="secondary" size="sm"
                leftIcon={<Download size={14} />}
                onClick={(e) => { e.stopPropagation(); handleDownloadPDF() }}
              >
                PDF
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Detail panels */}
      {activeReport === 'appointments' && data && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <Calendar size={18} className="text-brand-600" /> Citas del mes
          </h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Total', value: data.totalAppointments, color: 'text-foreground' },
              { label: 'Completadas', value: data.completedAppointments, color: 'text-green-600' },
              { label: 'Canceladas', value: data.cancelledAppointments, color: 'text-red-500' },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl bg-surface">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {data.recentAppointments.length > 0 && (
            <div className="space-y-2 mt-2">
              <p className="text-sm font-medium text-foreground mb-2">Últimas citas</p>
              {data.recentAppointments.map(apt => (
                <div key={apt.id} className="flex items-center justify-between p-3 rounded-xl bg-surface text-sm">
                  <div>
                    <p className="font-medium text-foreground">{apt.client?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{apt.service?.name ?? '—'} · {formatDate(apt.start_at, 'd MMM, HH:mm')}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    apt.status === 'completed' ? 'bg-green-100 text-green-700' :
                    apt.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                    apt.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{apt.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeReport === 'finances' && data && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <DollarSign size={18} className="text-brand-600" /> Balance del mes
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Ingresos', value: data.totalRevenue, color: 'text-green-600', bar: 'bg-green-500' },
              { label: 'Gastos', value: data.totalExpenses, color: 'text-red-500', bar: 'bg-red-400' },
              { label: 'Ganancia neta', value: data.netProfit, color: data.netProfit >= 0 ? 'text-brand-600' : 'text-red-600', bar: 'bg-brand-600' },
            ].map(s => (
              <div key={s.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className={`font-semibold ${s.color}`}>{formatCurrency(s.value)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${s.bar} rounded-full`}
                    style={{ width: data.totalRevenue > 0 ? `${Math.min(Math.abs(s.value) / data.totalRevenue * 100, 100)}%` : '0%' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeReport === 'services' && data && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <Star size={18} className="text-brand-600" /> Servicios populares
          </h2>
          {Object.keys(data.byService).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin citas este mes</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.byService)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([name, { count, revenue }], i) => (
                  <div key={name} className="flex items-center gap-4 p-3 rounded-xl bg-surface">
                    <span className="text-lg font-bold text-muted-foreground w-6">#{i + 1}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{name}</p>
                      <p className="text-xs text-muted-foreground">{count} citas</p>
                    </div>
                    <p className="text-sm font-semibold text-green-600">{formatCurrency(revenue)}</p>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {activeReport === 'clients' && data && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <Users size={18} className="text-brand-600" /> Clientes
          </h2>
          <div className="text-center py-4">
            <p className="text-5xl font-black text-brand-600">{data.totalClients}</p>
            <p className="text-muted-foreground text-sm mt-2">clientes registrados en tu negocio</p>
          </div>
        </Card>
      )}
    </div>
  )
}