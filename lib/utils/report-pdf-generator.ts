'use client'

/**
 * report-pdf-generator.ts
 *
 * Generates professional, print-ready HTML reports that open in a new tab.
 * The user saves them as PDF via the browser's native print dialog (Ctrl+P →
 * "Save as PDF"). This produces vectorial output — no screenshot artifacts.
 *
 * SDD: pure UI utility (presentation layer). Zero domain logic.
 */

/* ──────────────────────────── types ───────────────────────────── */

export interface ReportAppointment {
  id: string
  start_at: string
  status: string | null
  service: { name: string; price: number } | null
  client: { name: string } | null
}

export interface ReportPdfData {
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
  businessName?:         string
}

/* ─────────────────────── shared helpers ───────────────────────── */

function fmt(value: number): string {
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function now(): string {
  return new Date().toLocaleDateString('es', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completada',
  cancelled:  'Cancelada',
  confirmed:  'Confirmada',
  pending:    'Pendiente',
  no_show:    'No asistió',
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  cancelled:  '#ef4444',
  confirmed:  '#3b82f6',
  pending:    '#f59e0b',
  no_show:    '#6b7280',
}

/* ──────────────────── shared page chrome ──────────────────────── */

function baseStyles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      max-width: 900px;
      margin: 0 auto;
      padding: 48px 40px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 24px;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 32px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-name { font-size: 18px; font-weight: 700; color: #0f172a; }
    .brand-sub  { font-size: 12px; color: #64748b; margin-top: 1px; }
    .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.6; }

    /* ── Section title ── */
    .section-title {
      font-size: 13px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #0062FF;
      margin-bottom: 16px; margin-top: 32px;
      padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
    }
    .section-title:first-of-type { margin-top: 0; }

    /* ── KPI grid ── */
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .kpi-card {
      border-radius: 14px; padding: 20px 18px;
      background: #fff; border: 1px solid #e2e8f0;
      box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    }
    .kpi-card.accent {
      background: linear-gradient(135deg, #0062FF 0%, #3884FF 100%);
      border: none; color: #fff;
    }
    .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; }
    .kpi-card.accent .kpi-label { color: rgba(255,255,255,0.75); }
    .kpi-value { font-size: 32px; font-weight: 900; margin-top: 6px; color: #0f172a; }
    .kpi-card.accent .kpi-value { color: #fff; }
    .kpi-sub { font-size: 11px; margin-top: 4px; color: #94a3b8; }
    .kpi-card.accent .kpi-sub { color: rgba(255,255,255,0.65); }

    /* ── Finance row ── */
    .finance-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .finance-card {
      border-radius: 12px; padding: 16px;
      background: #fff; border: 1px solid #e2e8f0;
      display: flex; align-items: center; gap: 14px;
    }
    .finance-icon {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
    }
    .finance-label { font-size: 11px; color: #64748b; font-weight: 500; }
    .finance-value { font-size: 20px; font-weight: 800; margin-top: 2px; }

    /* ── Bar ── */
    .bar-row { margin-bottom: 14px; }
    .bar-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
    .bar-label { color: #475569; }
    .bar-value { font-weight: 700; }
    .bar-track { height: 8px; border-radius: 99px; background: #e2e8f0; overflow: hidden; }
    .bar-fill  { height: 100%; border-radius: 99px; }

    /* ── Table ── */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th {
      text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: #64748b; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
    }
    thead th:first-child { border-radius: 8px 0 0 0; }
    thead th:last-child  { border-radius: 0 8px 0 0; text-align: right; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child { border-bottom: none; }
    tbody td { padding: 11px 12px; color: #334155; vertical-align: middle; }
    tbody td:last-child { text-align: right; }

    /* ── Status pill ── */
    .pill {
      display: inline-block; padding: 2px 8px; border-radius: 99px;
      font-size: 11px; font-weight: 600;
    }

    /* ── Rank badge ── */
    .rank { font-weight: 800; color: #94a3b8; width: 28px; display: inline-block; }
    .rank.gold { color: #f59e0b; }

    /* ── Big number ── */
    .big-number {
      text-align: center; padding: 48px 0;
    }
    .big-number-value { font-size: 80px; font-weight: 900; line-height: 1; }
    .big-number-label { font-size: 14px; color: #64748b; margin-top: 12px; }

    /* ── Footer ── */
    .footer {
      margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0;
      font-size: 11px; color: #94a3b8; text-align: center;
    }

    /* ── Print overrides ── */
    @media print {
      body { background: #fff; }
      .page { padding: 24px 28px; }
      .no-break { page-break-inside: avoid; }
    }
  `
}

function pageHeader(title: string, subtitle: string, businessName?: string): string {
  return `
    <div class="header">
      <div class="brand">
        <img
          src="/icon.png"
          alt="Cronix"
          width="44"
          height="44"
          style="border-radius:12px;object-fit:cover;flex-shrink:0;"
        />
        <div>
          <div class="brand-name">${businessName ?? 'Cronix'}</div>
          <div class="brand-sub">Sistema de Gestión</div>
        </div>
      </div>
      <div class="meta">
        <strong style="font-size:15px;color:#0f172a;">${title}</strong><br>
        ${subtitle}<br>
        Generado el ${now()}
      </div>
    </div>
  `
}

function pageFooter(): string {
  return `<div class="footer">Generado automáticamente por Cronix · ${now()} · Uso interno</div>`
}

function openPrintWindow(html: string): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  // Give fonts time to load before triggering print
  win.onload = () => setTimeout(() => win.print(), 600)
}

function buildDocument(body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reporte Cronix</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="page">
    ${body}
  </div>
</body>
</html>`
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC API — one function per report type
   ═══════════════════════════════════════════════════════════════ */

/** Full combined report — "Exportar reporte" button */
export function generateGeneralReport(data: ReportPdfData): void {
  const base = Math.max(data.billed, data.collected, data.expenses, 1)

  const body = `
    ${pageHeader('Reporte General', 'Métricas del mes actual', data.businessName)}

    <!-- KPIs -->
    <p class="section-title">Resumen del mes</p>
    <div class="kpi-grid no-break">
      <div class="kpi-card accent">
        <div class="kpi-label">Ingresos cobrados</div>
        <div class="kpi-value">${fmt(data.collected)}</div>
        <div class="kpi-sub">Caja real del mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total de citas</div>
        <div class="kpi-value">${data.totalAppointments}</div>
        <div class="kpi-sub">${data.completedAppointments} completadas · ${data.cancelledAppointments} canceladas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clientes registrados</div>
        <div class="kpi-value">${data.totalClients}</div>
        <div class="kpi-sub">Total activos en el sistema</div>
      </div>
    </div>

    <!-- Finanzas -->
    <p class="section-title">Resumen financiero</p>
    <div class="finance-grid no-break">
      <div class="finance-card">
        <div class="finance-icon" style="background:#dcfce7;">💰</div>
        <div>
          <div class="finance-label">Prestado (lista)</div>
          <div class="finance-value" style="color:#16a34a;">${fmt(data.billed)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:#dbeafe;">🏦</div>
        <div>
          <div class="finance-label">Cobrado (caja)</div>
          <div class="finance-value" style="color:#2563eb;">${fmt(data.collected)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:#fee2e2;">📉</div>
        <div>
          <div class="finance-label">Gastos</div>
          <div class="finance-value" style="color:#dc2626;">${fmt(data.expenses)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:${data.netProfit >= 0 ? '#dbeafe' : '#fee2e2'};">
          ${data.netProfit >= 0 ? '📈' : '📉'}
        </div>
        <div>
          <div class="finance-label">Utilidad neta</div>
          <div class="finance-value" style="color:${data.netProfit >= 0 ? '#2563eb' : '#dc2626'};">
            ${fmt(data.netProfit)}
          </div>
        </div>
      </div>
    </div>

    <!-- Barras relativas -->
    <div style="margin-top:20px;" class="no-break">
      ${[
        { label: 'Prestado',  value: data.billed,    color: '#22c55e' },
        { label: 'Cobrado',   value: data.collected, color: '#3b82f6' },
        { label: 'Gastos',    value: data.expenses,  color: '#ef4444' },
      ].map(r => `
        <div class="bar-row">
          <div class="bar-header">
            <span class="bar-label">${r.label}</span>
            <span class="bar-value" style="color:${r.color};">${fmt(r.value)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(Math.abs(r.value) / base * 100, 100).toFixed(1)}%;background:${r.color};"></div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Servicios -->
    ${Object.keys(data.byService).length > 0 ? `
    <p class="section-title">Servicios más demandados</p>
    <table class="no-break">
      <thead>
        <tr>
          <th>#</th>
          <th>Servicio</th>
          <th>Citas</th>
          <th>Ingresos</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(data.byService)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([name, { count, revenue }], i) => `
          <tr>
            <td><span class="rank ${i === 0 ? 'gold' : ''}">#${i + 1}</span></td>
            <td>${name}</td>
            <td>${count}</td>
            <td><strong style="color:#16a34a;">${fmt(revenue)}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : ''}

    <!-- Últimas citas -->
    ${data.recentAppointments.length > 0 ? `
    <p class="section-title">Últimas citas del mes</p>
    <table class="no-break">
      <thead>
        <tr><th>Cliente</th><th>Servicio</th><th>Fecha</th><th>Estado</th></tr>
      </thead>
      <tbody>
        ${data.recentAppointments.slice(0, 10).map(apt => {
          const sk = (apt.status ?? 'pending') as string
          const color = STATUS_COLORS[sk] ?? '#6b7280'
          const label = STATUS_LABELS[sk] ?? apt.status ?? '—'
          return `
          <tr>
            <td>${apt.client?.name ?? '—'}</td>
            <td>${apt.service?.name ?? '—'}</td>
            <td>${fmtDate(apt.start_at)}</td>
            <td>
              <span class="pill" style="background:${color}20;color:${color};">${label}</span>
            </td>
          </tr>`
        }).join('')}
      </tbody>
    </table>` : ''}

    ${pageFooter()}
  `
  openPrintWindow(buildDocument(body))
}

/** Appointments-only report */
export function generateAppointmentsReport(data: ReportPdfData): void {
  const body = `
    ${pageHeader('Reporte de Citas', 'Rendimiento de citas del mes', data.businessName)}

    <div class="kpi-grid no-break">
      <div class="kpi-card accent">
        <div class="kpi-label">Total de citas</div>
        <div class="kpi-value">${data.totalAppointments}</div>
        <div class="kpi-sub">Este mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Completadas</div>
        <div class="kpi-value" style="color:#22c55e;">${data.completedAppointments}</div>
        <div class="kpi-sub">${data.totalAppointments > 0 ? ((data.completedAppointments / data.totalAppointments) * 100).toFixed(1) : 0}% del total</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Canceladas</div>
        <div class="kpi-value" style="color:#ef4444;">${data.cancelledAppointments}</div>
        <div class="kpi-sub">${data.totalAppointments > 0 ? ((data.cancelledAppointments / data.totalAppointments) * 100).toFixed(1) : 0}% del total</div>
      </div>
    </div>

    ${data.recentAppointments.length > 0 ? `
    <p class="section-title">Detalle de citas</p>
    <table>
      <thead>
        <tr><th>Cliente</th><th>Servicio</th><th>Fecha y hora</th><th>Estado</th></tr>
      </thead>
      <tbody>
        ${data.recentAppointments.map(apt => {
          const sk = (apt.status ?? 'pending') as string
          const color = STATUS_COLORS[sk] ?? '#6b7280'
          const label = STATUS_LABELS[sk] ?? apt.status ?? '—'
          return `
          <tr>
            <td><strong>${apt.client?.name ?? '—'}</strong></td>
            <td>${apt.service?.name ?? '—'}</td>
            <td>${fmtDate(apt.start_at)}</td>
            <td><span class="pill" style="background:${color}20;color:${color};">${label}</span></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>` : '<p style="color:#94a3b8;text-align:center;padding:32px 0;">Sin citas registradas este mes.</p>'}

    ${pageFooter()}
  `
  openPrintWindow(buildDocument(body))
}

/** Finances-only report */
export function generateFinancesReport(data: ReportPdfData): void {
  const base = Math.max(data.billed, data.collected, data.expenses, 1)
  const collectionRate = data.billed > 0 ? (data.collected / data.billed * 100).toFixed(1) : '0.0'

  const body = `
    ${pageHeader('Reporte Financiero', 'Resumen financiero del mes', data.businessName)}

    <div class="finance-grid no-break">
      <div class="finance-card">
        <div class="finance-icon" style="background:#dcfce7;">💰</div>
        <div>
          <div class="finance-label">Prestado (precio de lista)</div>
          <div class="finance-value" style="color:#16a34a;">${fmt(data.billed)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:#dbeafe;">🏦</div>
        <div>
          <div class="finance-label">Cobrado (caja real)</div>
          <div class="finance-value" style="color:#2563eb;">${fmt(data.collected)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:#fee2e2;">📉</div>
        <div>
          <div class="finance-label">Gastos del mes</div>
          <div class="finance-value" style="color:#dc2626;">${fmt(data.expenses)}</div>
        </div>
      </div>
      <div class="finance-card">
        <div class="finance-icon" style="background:${data.netProfit >= 0 ? '#dbeafe' : '#fee2e2'};">
          ${data.netProfit >= 0 ? '📈' : '📉'}
        </div>
        <div>
          <div class="finance-label">Utilidad neta (Cobrado − Gastos)</div>
          <div class="finance-value" style="color:${data.netProfit >= 0 ? '#2563eb' : '#dc2626'};">
            ${fmt(data.netProfit)}
          </div>
        </div>
      </div>
    </div>

    <p class="section-title">Análisis comparativo</p>
    <div class="no-break">
      ${[
        { label: 'Prestado (lista)',  value: data.billed,    color: '#22c55e' },
        { label: 'Cobrado (caja)',    value: data.collected, color: '#3b82f6' },
        { label: 'Gastos',           value: data.expenses,  color: '#ef4444' },
        { label: 'Utilidad neta',    value: data.netProfit, color: data.netProfit >= 0 ? '#3b82f6' : '#ef4444' },
      ].map(r => `
        <div class="bar-row">
          <div class="bar-header">
            <span class="bar-label">${r.label}</span>
            <span class="bar-value" style="color:${r.color};">${fmt(r.value)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.min(Math.abs(r.value) / base * 100, 100).toFixed(1)}%;background:${r.color};"></div>
          </div>
        </div>
      `).join('')}
    </div>

    <p class="section-title">Indicadores clave</p>
    <table class="no-break">
      <thead>
        <tr><th>Indicador</th><th>Valor</th></tr>
      </thead>
      <tbody>
        <tr><td>Tasa de cobro (Cobrado / Prestado)</td><td><strong>${collectionRate}%</strong></td></tr>
        <tr><td>Margen neto (Utilidad / Cobrado)</td>
          <td><strong>${data.collected > 0 ? (data.netProfit / data.collected * 100).toFixed(1) : 0}%</strong></td></tr>
        <tr><td>Gastos como % del cobrado</td>
          <td><strong>${data.collected > 0 ? (data.expenses / data.collected * 100).toFixed(1) : 0}%</strong></td></tr>
      </tbody>
    </table>

    ${pageFooter()}
  `
  openPrintWindow(buildDocument(body))
}

/** Clients-only report */
export function generateClientsReport(data: ReportPdfData): void {
  const body = `
    ${pageHeader('Reporte de Clientes', 'Crecimiento de clientes', data.businessName)}

    <div class="big-number no-break">
      <div class="big-number-value" style="color:#0062FF;">${data.totalClients}</div>
      <div class="big-number-label">Clientes activos registrados en el sistema</div>
    </div>

    <p class="section-title">Actividad del mes</p>
    <table class="no-break">
      <thead>
        <tr><th>Indicador</th><th>Valor</th></tr>
      </thead>
      <tbody>
        <tr><td>Citas realizadas este mes</td><td><strong>${data.totalAppointments}</strong></td></tr>
        <tr><td>Citas completadas</td><td><strong style="color:#22c55e;">${data.completedAppointments}</strong></td></tr>
        <tr><td>Promedio de citas por cliente activo</td>
          <td><strong>${data.totalClients > 0 ? (data.totalAppointments / data.totalClients).toFixed(1) : 0}</strong></td></tr>
      </tbody>
    </table>

    ${data.recentAppointments.length > 0 ? `
    <p class="section-title">Clientes atendidos este mes</p>
    <table class="no-break">
      <thead>
        <tr><th>Cliente</th><th>Servicio</th><th>Fecha</th><th>Estado</th></tr>
      </thead>
      <tbody>
        ${data.recentAppointments.map(apt => {
          const sk = (apt.status ?? 'pending') as string
          const color = STATUS_COLORS[sk] ?? '#6b7280'
          const label = STATUS_LABELS[sk] ?? apt.status ?? '—'
          return `
          <tr>
            <td><strong>${apt.client?.name ?? '—'}</strong></td>
            <td>${apt.service?.name ?? '—'}</td>
            <td>${fmtDate(apt.start_at)}</td>
            <td><span class="pill" style="background:${color}20;color:${color};">${label}</span></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>` : ''}

    ${pageFooter()}
  `
  openPrintWindow(buildDocument(body))
}

/** Services-only report */
export function generateServicesReport(data: ReportPdfData): void {
  const entries = Object.entries(data.byService).sort((a, b) => b[1].count - a[1].count)
  const topCount = entries[0]?.[1].count ?? 1

  const body = `
    ${pageHeader('Reporte de Servicios', 'Servicios más demandados del mes', data.businessName)}

    ${entries.length === 0
      ? '<p style="color:#94a3b8;text-align:center;padding:32px 0;">Sin servicios registrados este mes.</p>'
      : `
    <div class="kpi-grid no-break" style="margin-bottom:24px;">
      <div class="kpi-card accent">
        <div class="kpi-label">Servicios distintos</div>
        <div class="kpi-value">${entries.length}</div>
        <div class="kpi-sub">Ofertados este mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Servicio #1</div>
        <div class="kpi-value" style="font-size:20px;margin-top:8px;">${entries[0]?.[0] ?? '—'}</div>
        <div class="kpi-sub">${entries[0]?.[1].count ?? 0} citas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total ingresos servicios</div>
        <div class="kpi-value" style="font-size:24px;margin-top:8px;">${fmt(entries.reduce((s, [, v]) => s + v.revenue, 0))}</div>
        <div class="kpi-sub">Base prestado (lista)</div>
      </div>
    </div>

    <p class="section-title">Ranking de servicios</p>
    <table>
      <thead>
        <tr><th>#</th><th>Servicio</th><th>Citas</th><th>Demanda relativa</th><th>Ingresos</th></tr>
      </thead>
      <tbody>
        ${entries.map(([name, { count, revenue }], i) => `
          <tr>
            <td><span class="rank ${i === 0 ? 'gold' : ''}">#${i + 1}</span></td>
            <td><strong>${name}</strong></td>
            <td>${count}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:6px;border-radius:99px;background:#e2e8f0;overflow:hidden;">
                  <div style="height:100%;border-radius:99px;background:#0062FF;width:${(count / topCount * 100).toFixed(1)}%;"></div>
                </div>
                <span style="font-size:11px;color:#64748b;white-space:nowrap;">${(count / topCount * 100).toFixed(0)}%</span>
              </div>
            </td>
            <td><strong style="color:#16a34a;">${fmt(revenue)}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `}

    ${pageFooter()}
  `
  openPrintWindow(buildDocument(body))
}
