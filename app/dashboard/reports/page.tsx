import type { Metadata } from 'next'
import { BarChart3, FileText, Download, TrendingUp } from 'lucide-react'
import { Card, StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { mockFinanceSummary, mockDashboardStats } from '@/lib/mock/data'
import { formatCurrency } from '@/lib/utils'

export const metadata: Metadata = { title: 'Reportes' }

export default function ReportsPage() {
  const summary = mockFinanceSummary
  const stats = mockDashboardStats

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reportes</h1>
          <p className="text-muted-foreground text-sm">Exporta y analiza el rendimiento de tu negocio</p>
        </div>
        <Button leftIcon={<Download size={16} />}>Exportar PDF</Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Ingresos totales"
          value={formatCurrency(summary.totalRevenue)}
          icon={<TrendingUp size={22} />}
          accent
        />
        <StatCard title="Total citas" value={stats.appointmentsThisWeek} icon={<BarChart3 size={22} />} />
        <StatCard title="Clientes atendidos" value={stats.totalClients} icon={<TrendingUp size={22} />} />
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { title: 'Reporte de Citas',    sub: 'Citas por período, estado y empleado', period: 'Mensual',  icon: '📅' },
          { title: 'Balance Financiero',  sub: 'Ingresos vs gastos con gráficas',      period: 'Mensual',  icon: '💰' },
          { title: 'Reporte de Clientes', sub: 'Frecuencia, gasto y métricas CRM',     period: 'Anual',    icon: '👥' },
          { title: 'Reporte Semanal',     sub: 'Resumen de la semana actual',          period: 'Semanal',  icon: '📊' },
          { title: 'Reporte Anual',       sub: 'Resumen completo del año',             period: 'Anual',    icon: '📈' },
          { title: 'Servicios Populares', sub: 'Ranking por frecuencia e ingresos',    period: 'Mensual',  icon: '⭐' },
        ].map((r) => (
          <Card key={r.title} interactive className="group">
            <div className="flex items-start justify-between mb-3">
              <span className="text-3xl">{r.icon}</span>
              <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">{r.period}</span>
            </div>
            <h3 className="font-semibold text-foreground mb-1 group-hover:text-brand-600 transition-colors">
              {r.title}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">{r.sub}</p>
            <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} className="w-full">
              Descargar PDF
            </Button>
          </Card>
        ))}
      </div>

      {/* Coming soon notice */}
      <Card className="text-center py-8 border-dashed">
        <FileText size={32} className="text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="font-medium text-foreground">Reportes con gráficas interactivas</p>
        <p className="text-sm text-muted-foreground mt-1">Próximamente disponibles en Agendo Pro</p>
      </Card>
    </div>
  )
}
