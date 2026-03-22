'use client'

import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Download, Users, Calendar, DollarSign, Star } from 'lucide-react'
import { Card, StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBusinessContext } from '@/lib/hooks/use-business-context'
import * as financesRepo from '@/lib/repositories/finances.repo'
import { formatCurrency, formatDate } from '@/lib/utils'

interface ReportAppointment {
  id: string
  start_at: string
  status: string | null
  service: { name: string; price: number } | null
  client: { name: string } | null
}

interface ReportData {
  totalAppointments:     number
  completedAppointments: number
  cancelledAppointments: number
  totalClients:          number
  totalRevenue:          number
  totalExpenses:         number
  netProfit:             number
  byService:             Record<string, { count: number; revenue: number }>
  recentAppointments:    ReportAppointment[]
}

// ── Status color map ──────────────────────────────────────────────────────────
const STATUS_STYLES = {
  completed: { bg: 'rgba(48,209,88,0.1)',  color: '#30D158', label: 'Completada' },
  cancelled: { bg: 'rgba(255,59,48,0.1)',  color: '#FF3B30', label: 'Cancelada'  },
  confirmed: { bg: 'rgba(56,132,255,0.1)', color: '#3884FF', label: 'Confirmada' },
  pending:   { bg: 'rgba(255,214,10,0.1)', color: '#FFD60A', label: 'Pendiente'  },
  no_show:   { bg: 'rgba(150,150,150,0.1)', color: '#909098', label: 'No se presentó' },
} as const

export default function ReportsPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext()
  const [data,         setData]         = useState<ReportData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [activeReport, setActiveReport] = useState<string | null>(null)

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoading(false)
      return
    }

    async function loadData() {
      try {
        const now        = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

        // Parallel queries via repos + direct supabase for complex JOINs
        const [aptsRes, clientsRes, txns, expenses] = await Promise.all([
          supabase
            .from('appointments')
            .select('id, start_at, status, service:services(name, price), client:clients(name)')
            .eq('business_id', businessId!)
            .gte('start_at', monthStart)
            .lte('start_at', monthEnd)
            .order('start_at', { ascending: false }),
          supabase
            .from('clients')
            .select('id', { count: 'exact' })
            .eq('business_id', businessId!)
            .is('deleted_at', null),
          financesRepo.getTransactions(supabase, businessId!),
          financesRepo.getExpenses(supabase, businessId!),
        ])

        const apts = (aptsRes.data ?? []) as ReportAppointment[]
        const monthTxns = txns.filter(t => (t.paid_at ?? '') >= monthStart && (t.paid_at ?? '') <= monthEnd)
        const monthExps = expenses.filter(e => (e.expense_date ?? '') >= (monthStart.split('T')[0] ?? '') && (e.expense_date ?? '') <= (monthEnd.split('T')[0] ?? ''))

        const totalRevenue  = monthTxns.reduce((s, t) => s + (t.net_amount ?? 0), 0)
        const totalExpenses = monthExps.reduce((s, e) => s + e.amount, 0)

        const byService: Record<string, { count: number; revenue: number }> = {}
        apts.forEach(apt => {
          const name = apt.service?.name ?? 'Sin servicio'
          if (!byService[name]) byService[name] = { count: 0, revenue: 0 }
          byService[name].count++
          if (apt.status === 'completed') byService[name].revenue += apt.service?.price ?? 0
        })

        setData({
          totalAppointments:     apts.length,
          completedAppointments: apts.filter(a => a.status === 'completed').length,
          cancelledAppointments: apts.filter(a => a.status === 'cancelled').length,
          totalClients:          clientsRes.count ?? 0,
          totalRevenue,
          totalExpenses,
          netProfit:             totalRevenue - totalExpenses,
          byService,
          recentAppointments:    apts.slice(0, 10),
        })
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'No se pudieron cargar los reportes')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [supabase, businessId, contextLoading])

  const handleDownloadReport = () => {
    if (!data) return
    const lines = [
      'REPORTE MENSUAL - CRONIX',
      '========================',
      '',
      `Citas totales:      ${data.totalAppointments}`,
      `Citas completadas:  ${data.completedAppointments}`,
      `Citas canceladas:   ${data.cancelledAppointments}`,
      `Total clientes:     ${data.totalClients}`,
      '',
      `Ingresos del mes:   ${formatCurrency(data.totalRevenue)}`,
      `Gastos del mes:     ${formatCurrency(data.totalExpenses)}`,
      `Ganancia neta:      ${formatCurrency(data.netProfit)}`,
      '',
      'SERVICIOS MÁS POPULARES:',
      ...Object.entries(data.byService)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, { count, revenue }]) =>
          `  ${name}: ${count} citas — ${formatCurrency(revenue)}`
        ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `reporte-cronix-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reportCards = [
    { id: 'appointments', title: 'Reporte de Citas',    sub: 'Citas por estado y servicio',    period: 'Mensual', icon: '📅' },
    { id: 'finances',     title: 'Balance Financiero',  sub: 'Ingresos vs gastos',             period: 'Mensual', icon: '💰' },
    { id: 'clients',      title: 'Reporte de Clientes', sub: 'Total y métricas CRM',           period: 'General', icon: '👥' },
    { id: 'services',     title: 'Servicios Populares', sub: 'Ranking por frecuencia e ingresos', period: 'Mensual', icon: '⭐' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-t-transparent rounded-full"
          style={{ borderColor: '#0062FF', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-2">
        <p className="text-sm font-medium" style={{ color: '#FF3B30' }}>No se pudieron cargar los reportes</p>
        <p className="text-xs" style={{ color: '#8A8A90' }}>{fetchError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F2F2F2' }}>Reportes</h1>
          <p className="text-sm" style={{ color: '#909098' }}>
            Análisis del rendimiento de tu negocio — mes actual
          </p>
        </div>
        <Button leftIcon={<Download size={16} />} onClick={handleDownloadReport}>
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

      {/* Report selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {reportCards.map(r => (
          <div
            key={r.id}
            className="cursor-pointer transition-all duration-200 rounded-2xl p-4"
            onClick={() => setActiveReport(activeReport === r.id ? null : r.id)}
            style={{
              background: activeReport === r.id ? 'rgba(0,98,255,0.1)' : '#1A1A1F',
              border:     activeReport === r.id ? '1px solid rgba(0,98,255,0.35)' : '1px solid #2E2E33',
            }}
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl flex-shrink-0">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: '#F2F2F2' }}>{r.title}</p>
                <p className="text-xs mt-0.5" style={{ color: '#909098' }}>{r.sub}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{ background: 'rgba(0,98,255,0.1)', color: '#3884FF' }}>
                    {r.period}
                  </span>
                  <Button
                    variant="secondary" size="sm"
                    leftIcon={<Download size={14} />}
                    onClick={(e) => { e.stopPropagation(); handleDownloadReport() }}
                  >
                    TXT
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail: Appointments ── */}
      {activeReport === 'appointments' && data && (
        <Card>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F2F2F2' }}>
            <Calendar size={18} style={{ color: '#0062FF' }} /> Citas del mes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Total',       value: data.totalAppointments,     color: '#F2F2F2'  },
              { label: 'Completadas', value: data.completedAppointments, color: '#30D158'  },
              { label: 'Canceladas',  value: data.cancelledAppointments, color: '#FF3B30'  },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl"
                style={{ background: '#212125', border: '1px solid #2E2E33' }}>
                <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs mt-1" style={{ color: '#909098' }}>{s.label}</p>
              </div>
            ))}
          </div>
          {data.recentAppointments.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2" style={{ color: '#F2F2F2' }}>Últimas citas</p>
              {data.recentAppointments.map(apt => {
                const statusKey = (apt.status || 'pending') as keyof typeof STATUS_STYLES
                const s = STATUS_STYLES[statusKey] || STATUS_STYLES.pending
                return (
                  <div key={apt.id}
                    className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: '#212125', border: '1px solid #2E2E33' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: '#F2F2F2' }}>
                        {apt.client?.name ?? '—'}
                      </p>
                      <p className="text-xs truncate" style={{ color: '#909098' }}>
                        {apt.service?.name ?? '—'} · {formatDate(apt.start_at, 'd MMM, HH:mm')}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-2 flex-shrink-0"
                      style={{ background: s.bg, color: s.color }}>
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Detail: Finances ── */}
      {activeReport === 'finances' && data && (
        <Card>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F2F2F2' }}>
            <DollarSign size={18} style={{ color: '#0062FF' }} /> Balance del mes
          </h2>
          <div className="space-y-4">
            {[
              { label: 'Ingresos',      value: data.totalRevenue,  color: '#30D158', barBg: 'rgba(48,209,88,0.5)'  },
              { label: 'Gastos',        value: data.totalExpenses, color: '#FF3B30', barBg: 'rgba(255,59,48,0.5)'  },
              { label: 'Ganancia neta', value: data.netProfit,     color: data.netProfit >= 0 ? '#3884FF' : '#FF3B30', barBg: 'rgba(56,132,255,0.5)' },
            ].map(s => (
              <div key={s.label}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span style={{ color: '#909098' }}>{s.label}</span>
                  <span className="font-semibold" style={{ color: s.color }}>
                    {formatCurrency(s.value)}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      background: s.barBg,
                      width: data.totalRevenue > 0
                        ? `${Math.min(Math.abs(s.value) / data.totalRevenue * 100, 100)}%`
                        : '0%',
                    }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Detail: Services ── */}
      {activeReport === 'services' && data && (
        <Card>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F2F2F2' }}>
            <Star size={18} style={{ color: '#0062FF' }} /> Servicios populares
          </h2>
          {Object.keys(data.byService).length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: '#909098' }}>
              Sin citas este mes
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.byService)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([name, { count, revenue }], i) => (
                  <div key={name} className="flex items-center gap-4 p-3 rounded-xl"
                    style={{ background: '#212125', border: '1px solid #2E2E33' }}>
                    <span className="text-lg font-bold w-6 flex-shrink-0" style={{ color: '#6A6A72' }}>
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: '#F2F2F2' }}>{name}</p>
                      <p className="text-xs" style={{ color: '#909098' }}>{count} citas</p>
                    </div>
                    <p className="text-sm font-semibold flex-shrink-0" style={{ color: '#30D158' }}>
                      {formatCurrency(revenue)}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Detail: Clients ── */}
      {activeReport === 'clients' && data && (
        <Card>
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F2F2F2' }}>
            <Users size={18} style={{ color: '#0062FF' }} /> Clientes registrados
          </h2>
          <div className="text-center py-6">
            <p className="text-6xl font-black" style={{ color: '#0062FF' }}>
              {data.totalClients}
            </p>
            <p className="text-sm mt-2" style={{ color: '#909098' }}>
              clientes registrados en tu negocio
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}