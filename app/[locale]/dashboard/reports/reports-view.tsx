'use client'

import { useState } from 'react'
import {
  BarChart3, TrendingUp, Download, Users, Calendar,
  DollarSign, Star, ArrowUpRight, Wallet,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { downloadElementAsPDF } from '@/lib/utils/pdf-generator'
import { useTranslations } from 'next-intl'

/* ─────────────────────────── types ─────────────────────────── */

interface ReportAppointment {
  id: string
  start_at: string
  status: string | null
  service: { name: string; price: number } | null
  client: { name: string } | null
}

export interface ReportData {
  totalAppointments:     number
  completedAppointments: number
  cancelledAppointments: number
  totalClients:          number
  billed:                number
  collected:             number
  expenses:              number
  netProfit:             number
  byService:             Record<string, { count: number; revenue: number }>
  recentAppointments:    ReportAppointment[]
}

/* ──────────────────────── constants ────────────────────────── */

const STATUS_STYLES = {
  completed: { bg: 'rgba(48,209,88,0.12)',  color: '#30D158', label: 'Completada'       },
  cancelled: { bg: 'rgba(255,59,48,0.12)',  color: '#FF3B30', label: 'Cancelada'        },
  confirmed: { bg: 'rgba(0,98,255,0.12)',   color: '#3884FF', label: 'Confirmada'       },
  pending:   { bg: 'rgba(255,214,10,0.12)', color: '#FFD60A', label: 'Pendiente'        },
  no_show:   { bg: 'rgba(144,144,152,0.12)', color: '#909098', label: 'No se presentó' },
} as const

/* A tiny decorative sparkline path — purely visual */
const SPARKLINE =
  'M0,18 C8,14 14,8 22,10 C30,12 36,4 44,6 C52,8 58,2 66,4 C74,6 80,0 88,2'

/* ─────────────────────── sub-components ────────────────────── */

/** Accent KPI card (income) */
function AccentKpiCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 flex flex-col justify-between"
      style={{
        background: 'linear-gradient(135deg, #0062FF 0%, #3884FF 100%)',
        boxShadow: '0 8px 32px rgba(0,98,255,0.35)',
        minHeight: 120,
      }}
    >
      {/* Glow orb */}
      <div
        className="pointer-events-none absolute -top-6 -right-6 w-32 h-32 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #fff 0%, transparent 70%)' }}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">{title}</p>
        <span
          className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
        >
          <ArrowUpRight size={11} /> Cobrado
        </span>
      </div>

      <p className="text-4xl font-black text-white mt-2 tracking-tight">{value}</p>

      {/* Sparkline */}
      <svg viewBox="0 0 88 20" className="w-full mt-3 opacity-50" style={{ height: 20 }}>
        <path d={SPARKLINE} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

/** Plain KPI card */
function KpiCard({
  title,
  value,
  icon,
}: {
  title: string
  value: number | string
  icon: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col justify-between"
      style={{
        background: '#15151E',
        border: '1px solid #2A2A38',
        minHeight: 120,
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#70708A' }}>
          {title}
        </p>
        <span
          className="flex items-center justify-center rounded-xl w-9 h-9"
          style={{ background: 'rgba(0,98,255,0.12)', color: '#3884FF' }}
        >
          {icon}
        </span>
      </div>
      <p className="text-4xl font-black mt-2 tracking-tight" style={{ color: '#F5F5F5' }}>
        {value}
      </p>
    </div>
  )
}

/** Category report card */
function ReportCategoryCard({
  id,
  title,
  sub,
  period,
  icon,
  accentColor,
  accentBg,
  active,
  onToggle,
  onDownload,
}: {
  id: string
  title: string
  sub: string
  period: string
  icon: React.ReactNode
  accentColor: string
  accentBg: string
  active: boolean
  onToggle: () => void
  onDownload: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className="cursor-pointer rounded-2xl p-4 transition-all duration-200 group"
      onClick={onToggle}
      style={{
        background: active ? `rgba(${hexToRgb(accentColor)},0.07)` : '#15151E',
        border: active
          ? `1px solid rgba(${hexToRgb(accentColor)},0.45)`
          : '1px solid #2A2A38',
        boxShadow: active ? `0 0 20px rgba(${hexToRgb(accentColor)},0.12)` : 'none',
        transform: active ? 'translateY(-2px)' : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon badge */}
        <span
          className="flex items-center justify-center rounded-2xl flex-shrink-0 w-11 h-11"
          style={{ background: accentBg, color: accentColor }}
        >
          {icon}
        </span>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: '#F5F5F5' }}>{title}</p>
          <p className="text-xs mt-0.5" style={{ color: '#70708A' }}>{sub}</p>

          <div className="flex items-center justify-between mt-3">
            <span
              className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: `rgba(${hexToRgb(accentColor)},0.12)`,
                color: accentColor,
              }}
            >
              {period}
            </span>

            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download size={13} />}
              onClick={onDownload}
            >
              PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Decorative accent bar */}
      <div
        className="mt-4 h-0.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: active ? '100%' : '35%',
            background: `linear-gradient(90deg, ${accentColor}, transparent)`,
          }}
        />
      </div>
    </div>
  )
}

/* ───────────────────────── helpers ─────────────────────────── */

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

/* ─────────────────────── main component ────────────────────── */

interface ReportsViewProps {
  data: ReportData
}

export function ReportsView({ data }: ReportsViewProps) {
  const [activeReport, setActiveReport] = useState<string | null>(null)
  const t = useTranslations('reports')

  const handleDownloadReport = () => {
    downloadElementAsPDF(
      'reports-wrapper',
      `Reporte_Cronix_${new Date().toISOString().split('T')[0]}.pdf`,
    )
  }

  const reportCards = [
    {
      id: 'appointments',
      title:       t('cards.appointments.title'),
      sub:         t('cards.appointments.sub'),
      period:      t('cards.appointments.period'),
      icon:        <Calendar size={20} />,
      accentColor: '#3884FF',
      accentBg:    'rgba(56,132,255,0.14)',
    },
    {
      id: 'finances',
      title:       t('cards.finances.title'),
      sub:         t('cards.finances.sub'),
      period:      t('cards.finances.period'),
      icon:        <DollarSign size={20} />,
      accentColor: '#30D158',
      accentBg:    'rgba(48,209,88,0.14)',
    },
    {
      id: 'clients',
      title:       t('cards.clients.title'),
      sub:         t('cards.clients.sub'),
      period:      t('cards.clients.period'),
      icon:        <Users size={20} />,
      accentColor: '#A78BFA',
      accentBg:    'rgba(167,139,250,0.14)',
    },
    {
      id: 'services',
      title:       t('cards.services.title'),
      sub:         t('cards.services.sub'),
      period:      t('cards.services.period'),
      icon:        <Star size={20} />,
      accentColor: '#FFB800',
      accentBg:    'rgba(255,184,0,0.14)',
    },
  ]

  return (
    <div
      id="reports-wrapper"
      className="space-y-6 animate-fade-in bg-[#0C0C12] p-4 rounded-xl -m-4"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F5F5F5' }}>
            {t('title')}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#70708A' }}>
            {t('subtitle')}
          </p>
        </div>
        <Button leftIcon={<Download size={16} />} onClick={handleDownloadReport}>
          {t('export')}
        </Button>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AccentKpiCard
          title={t('stats.incomeMonth')}
          value={formatCurrency(data.collected)}
        />
        <KpiCard
          title={t('stats.totalApp')}
          value={data.totalAppointments}
          icon={<BarChart3 size={18} />}
        />
        <KpiCard
          title={t('stats.clientsReg')}
          value={data.totalClients}
          icon={<Users size={18} />}
        />
      </div>

      {/* ── Report Category Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {reportCards.map(r => (
          <ReportCategoryCard
            key={r.id}
            id={r.id}
            title={r.title}
            sub={r.sub}
            period={r.period}
            icon={r.icon}
            accentColor={r.accentColor}
            accentBg={r.accentBg}
            active={activeReport === r.id}
            onToggle={() => setActiveReport(activeReport === r.id ? null : r.id)}
            onDownload={e => { e.stopPropagation(); handleDownloadReport() }}
          />
        ))}
      </div>

      {/* ── Detail: Appointments ── */}
      {activeReport === 'appointments' && (
        <Card style={{ border: '1px solid rgba(56,132,255,0.35)' }}>
          <h2
            className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F5F5F5' }}
          >
            <Calendar size={18} style={{ color: '#3884FF' }} />
            {t('sections.appointments')}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {([
              { label: t('stats.total'),     value: data.totalAppointments,     color: '#F5F5F5' },
              { label: t('stats.completed'), value: data.completedAppointments, color: '#30D158' },
              { label: t('stats.cancelled'), value: data.cancelledAppointments, color: '#FF3B30' },
            ] as const).map(s => (
              <div
                key={s.label}
                className="text-center p-4 rounded-xl"
                style={{ background: '#1C1C28', border: '1px solid #2A2A38' }}
              >
                <p className="text-3xl font-black" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs mt-1.5" style={{ color: '#70708A' }}>{s.label}</p>
              </div>
            ))}
          </div>

          {data.recentAppointments.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2" style={{ color: '#F5F5F5' }}>
                {t('misc.latestAppointments')}
              </p>
              {data.recentAppointments.map(apt => {
                const statusKey = (apt.status || 'pending') as keyof typeof STATUS_STYLES
                const s = STATUS_STYLES[statusKey] ?? STATUS_STYLES.pending
                return (
                  <div
                    key={apt.id}
                    className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background: '#1C1C28', border: '1px solid #2A2A38' }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: '#F5F5F5' }}>
                        {apt.client?.name ?? '—'}
                      </p>
                      <p className="text-xs truncate" style={{ color: '#70708A' }}>
                        {apt.service?.name ?? '—'} · {formatDate(apt.start_at, 'd MMM, h:mm a')}
                      </p>
                    </div>
                    <span
                      className="text-xs px-2.5 py-0.5 rounded-full font-semibold ml-2 flex-shrink-0"
                      style={{ background: s.bg, color: s.color }}
                    >
                      {t(`status.${statusKey}`) || s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Detail: Finances ── */}
      {activeReport === 'finances' && (
        <Card style={{ border: '1px solid rgba(48,209,88,0.35)' }}>
          <h2
            className="text-base font-semibold mb-5 flex items-center gap-2"
            style={{ color: '#F5F5F5' }}
          >
            <DollarSign size={18} style={{ color: '#30D158' }} />
            {t('sections.finances')}
          </h2>

          {/* Billed vs Collected highlight — §8 manifest: two separate metrics */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {([
              {
                label: t('stats.billed'),
                value: data.billed,
                icon: <TrendingUp size={16} />,
                color: '#30D158',
                bg:    'rgba(48,209,88,0.10)',
              },
              {
                label: t('stats.collected'),
                value: data.collected,
                icon: <Wallet size={16} />,
                color: '#3884FF',
                bg:    'rgba(56,132,255,0.10)',
              },
            ] as const).map(s => (
              <div
                key={s.label}
                className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: s.bg, border: `1px solid rgba(${hexToRgb(s.color)},0.2)` }}
              >
                <span
                  className="flex items-center justify-center rounded-xl w-8 h-8 flex-shrink-0"
                  style={{ background: `rgba(${hexToRgb(s.color)},0.2)`, color: s.color }}
                >
                  {s.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: '#70708A' }}>{s.label}</p>
                  <p className="text-base font-bold" style={{ color: s.color }}>
                    {formatCurrency(s.value)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Horizontal bars: expenses + netProfit */}
          <div className="space-y-4">
            {(() => {
              const base = Math.max(data.billed, data.collected, data.expenses, 1)
              return ([
                { label: t('stats.expenses'),  value: data.expenses,  color: '#FF3B30', barBg: 'rgba(255,59,48,0.45)'  },
                { label: t('stats.netProfit'), value: data.netProfit, color: data.netProfit >= 0 ? '#3884FF' : '#FF3B30', barBg: 'rgba(56,132,255,0.45)' },
              ] as const).map(s => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span style={{ color: '#70708A' }}>{s.label}</span>
                    <span className="font-semibold" style={{ color: s.color }}>
                      {formatCurrency(s.value)}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        background: s.barBg,
                        width: `${Math.min(Math.abs(s.value) / base * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            })()}
          </div>
        </Card>
      )}

      {/* ── Detail: Services ── */}
      {activeReport === 'services' && (
        <Card style={{ border: '1px solid rgba(255,184,0,0.35)' }}>
          <h2
            className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F5F5F5' }}
          >
            <Star size={18} style={{ color: '#FFB800' }} />
            {t('sections.services')}
          </h2>

          {Object.keys(data.byService).length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: '#70708A' }}>
              {t('misc.noAppointments')}
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.byService)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([name, { count, revenue }], i) => (
                  <div
                    key={name}
                    className="flex items-center gap-4 p-3 rounded-xl"
                    style={{ background: '#1C1C28', border: '1px solid #2A2A38' }}
                  >
                    <span
                      className="text-xs font-black w-7 h-7 flex items-center justify-center rounded-xl flex-shrink-0"
                      style={{
                        background: i === 0 ? 'rgba(255,184,0,0.18)' : 'rgba(255,255,255,0.05)',
                        color:      i === 0 ? '#FFB800' : '#70708A',
                      }}
                    >
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: '#F5F5F5' }}>{name}</p>
                      <p className="text-xs" style={{ color: '#70708A' }}>
                        {t('misc.appointmentsCount', { count })}
                      </p>
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
      {activeReport === 'clients' && (
        <Card style={{ border: '1px solid rgba(167,139,250,0.35)' }}>
          <h2
            className="text-base font-semibold mb-4 flex items-center gap-2"
            style={{ color: '#F5F5F5' }}
          >
            <Users size={18} style={{ color: '#A78BFA' }} />
            {t('sections.clients')}
          </h2>
          <div className="text-center py-8">
            <div
              className="inline-flex items-center justify-center w-24 h-24 rounded-full mb-4"
              style={{ background: 'rgba(167,139,250,0.12)', border: '2px solid rgba(167,139,250,0.3)' }}
            >
              <p className="text-4xl font-black" style={{ color: '#A78BFA' }}>
                {data.totalClients}
              </p>
            </div>
            <p className="text-sm" style={{ color: '#70708A' }}>
              {t('misc.clientsCountLabel')}
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}
