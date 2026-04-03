import { createClient } from '@/lib/supabase/server'
import { startOfDay, endOfDay, format, addDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { fuzzyFind } from './fuzzy-match'
import { logger } from '@/lib/logger'
import { sendReactivationMessage } from '@/lib/services/whatsapp.service'

/**
 * assistant-tools.ts — Server-side tools for the "Luis" AI Executive Assistant.
 * 
 * V4 Evolution: Multi-staff support & Actionable CRM.
 */

// ── READ: Resumen del día ──────────────────────────────────────────────────
export async function get_today_summary(business_id: string): Promise<string> {
  const supabase = await createClient()
  const todayStart = startOfDay(new Date()).toISOString()
  const todayEnd = endOfDay(new Date()).toISOString()

  const [incomeRes, apptRes] = await Promise.all([
    supabase.from('transactions').select('net_amount').eq('business_id', business_id).gte('paid_at', todayStart).lte('paid_at', todayEnd),
    supabase.from('appointments').select('status').eq('business_id', business_id).gte('start_at', todayStart).lte('start_at', todayEnd),
  ])

  if (incomeRes.error) {
    logger.error('TOOL-DB', `get_today_summary income failed: ${incomeRes.error.message}`, { business_id })
    return `Error al consultar ingresos: ${incomeRes.error.message}`
  }
  if (apptRes.error) {
    logger.error('TOOL-DB', `get_today_summary appointments failed: ${apptRes.error.message}`, { business_id })
    return `Error al consultar citas: ${apptRes.error.message}`
  }

  const totalIncome = (incomeRes.data ?? []).reduce((acc, r) => acc + Number(r.net_amount), 0)
  const appts = apptRes.data ?? []
  const completed = appts.filter(a => a.status === 'completed').length
  const pending    = appts.filter(a => a.status === 'pending' || a.status === 'confirmed').length
  const cancelled  = appts.filter(a => a.status === 'cancelled' || a.status === 'no_show').length
  const todayStr   = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  return `Resumen para hoy ${todayStr}: facturado hoy $${totalIncome.toLocaleString('es-CO')}. Citas: ${appts.length} en total, ${completed} atendidas, ${pending} pendientes, ${cancelled} canceladas.`
}

// ── READ: Huecos libres hoy ────────────────────────────────────────────────
export async function get_upcoming_gaps(business_id: string): Promise<string> {
  const supabase = await createClient()
  const todayStart = startOfDay(new Date()).toISOString()
  const todayEnd = endOfDay(new Date()).toISOString()

  const { data: appts, error } = await supabase
    .from('appointments').select('start_at, end_at').eq('business_id', business_id)
    .in('status', ['pending', 'confirmed']).gte('start_at', todayStart).lte('start_at', todayEnd)
    .order('start_at', { ascending: true })

  if (error) {
    logger.error('TOOL-DB', `get_upcoming_gaps failed: ${error.message}`, { business_id })
    return `Error al consultar agenda: ${error.message}`
  }
  if (!appts?.length) return 'Toda la agenda de hoy está libre, no hay citas programadas.'

  const fmt = (d: string) => format(new Date(d), 'h:mm a')
  const bloques = appts.map(a => `${fmt(a.start_at)} a ${fmt(a.end_at)}`)
  return `Los bloques OCUPADOS hoy son: ${bloques.join(', ')}. El resto del horario está disponible.`
}

// ── READ: Deuda de un cliente ──────────────────────────────────────────────
export async function get_client_debt(business_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()

  const { data: clients, error } = await supabase
    .from('clients').select('id, name, phone').eq('business_id', business_id).is('deleted_at', null)

  if (error) {
    logger.error('TOOL-DB', `get_client_debt failed: ${error.message}`, { business_id, client_name })
    return `Error buscando clientes: ${error.message}`
  }
  if (!clients?.length) return 'No tienes clientes registrados aún.'

  const result = fuzzyFind(clients, client_name)
  if (result.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (result.status === 'ambiguous') return `Encontré varios clientes parecidos: ${result.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client = result.match
  const { data: unpaid } = await supabase
    .from('appointments').select('start_at').eq('business_id', business_id).eq('client_id', client.id)
    .eq('status', 'completed').limit(5)

  if (!unpaid?.length) return `El cliente ${client.name} está al día.`
  return `El cliente ${client.name} (tel: ${client.phone}) tiene ${unpaid.length} cita(s) completada(s) recientes sin registrar pago.`
}

// ── WRITE: Cancelar cita ──────────────────────────────────────────────────
export async function cancel_appointment(business_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()

  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null)

  const result = fuzzyFind(clients ?? [], client_name)
  if (result.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (result.status === 'ambiguous') return `Encontré varios clientes parecidos: ${result.candidates.map(c => c.name).join(', ')}. ¿Cuál cancelo?`

  const client = result.match
  const now = new Date().toISOString()

  const { data: appts, error } = await supabase
    .from('appointments').select('id, start_at').eq('business_id', business_id).eq('client_id', client.id)
    .in('status', ['pending', 'confirmed']).gte('start_at', now).order('start_at', { ascending: true }).limit(1)

  if (error || !appts[0]) return `${client.name} no tiene citas próximas activas.`
  const apt = appts[0]

  const { error: updErr } = await supabase
    .from('appointments').update({ status: 'cancelled', updated_at: now }).eq('id', apt.id)

  if (updErr) {
    logger.error('TOOL-DB', `cancel_appointment failed: ${updErr.message}`, { business_id, apt_id: apt.id })
    return 'No pude cancelar la cita.'
  }

  return `Listo. Cancelé la cita de ${client.name} del ${format(new Date(apt.start_at), "EEEE d 'de' MMMM", { locale: es })}.`
}

// ── WRITE: Agendar cita (Multi-Staff) ─────────────────────────────────────
export async function book_appointment(
  business_id: string,
  client_name: string,
  service_name: string,
  date: string,
  staff_name?: string
): Promise<string> {
  const supabase = await createClient()

  // 🛑 SECURITY: Date range validation
  const apptDate = parseISO(date)
  if (isNaN(apptDate.getTime())) return 'La fecha proporcionada no es válida.'
  
  const now = new Date()
  if (apptDate < addDays(now, -365)) {
    return 'No puedo agendar citas con más de un año de antigüedad por seguridad.'
  }

  const [cliRes, svcRes] = await Promise.all([
    supabase.from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null),
    supabase.from('services').select('id, name, duration_min').eq('business_id', business_id).eq('is_active', true)
  ])

  const clientResult = fuzzyFind(cliRes.data ?? [], client_name)
  const serviceResult = fuzzyFind(svcRes.data ?? [], service_name)

  if (clientResult.status !== 'found') return `No encontré al cliente ${client_name}.`
  if (serviceResult.status !== 'found') return `No encontré el servicio ${service_name}.`

  const client = clientResult.match
  const service = serviceResult.match as { id: string; name: string; duration_min: number }

  let staff_id: string | null = null
  if (staff_name) {
    const { data: team } = await supabase
      .from('users').select('id, name').eq('business_id', business_id).eq('role', 'employee').eq('is_active', true)
    const staffMatch = fuzzyFind(team ?? [], staff_name)
    if (staffMatch.status === 'found') staff_id = staffMatch.match.id
  }

  const startISO = date
  const startMs  = new Date(startISO).getTime()
  const endISO   = new Date(startMs + (service.duration_min ?? 60) * 60_000).toISOString()

  const { data: row, error } = await supabase.from('appointments').insert({
    business_id, client_id: client.id, service_id: service.id, staff_id,
    start_at: startISO, end_at: endISO, status: 'pending', is_dual_booking: false,
  }).select('id').single()

  if (error || !row) {
    logger.error('TOOL-DB', `book_appointment failed: ${error?.message}`, { business_id, client_id: client.id })
    return 'No pude crear la cita.'
  }

  await supabase.from('appointment_services').insert({ appointment_id: row.id, service_id: service.id, sort_order: 0 })

  const staffStr = staff_name ? ` con ${staff_name}` : ''
  return `Listo. Agendé a ${client.name} para ${service.name}${staffStr} el ${format(parseISO(date), "EEEE d 'de' MMMM 'a las' h:mm a", { locale: es })}.`
}

// ── WRITE: Registrar pago ──────────────────────────────────────────────
export async function register_payment(
  business_id: string,
  client_name: string,
  amount: number,
  method: string
): Promise<string> {
  const supabase = await createClient()
  
  // 🛑 SECURITY: Negative amount protection
  if (amount <= 0) return 'El monto a cobrar debe ser mayor a cero.'
  if (amount > 100000000) return 'El monto excede los límites de seguridad permitidos.'

  const methodMap: Record<string, string> = { efectivo: 'cash', tarjeta: 'card', transferencia: 'transfer', qr: 'qr' }
  const normalizedMethod = methodMap[method.toLowerCase()] ?? 'other'

  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null)
  const result = fuzzyFind(clients ?? [], client_name)
  if (result.status !== 'found') return `No encontré al cliente ${client_name}.`

  const client = result.match
  const { error } = await supabase.from('transactions').insert({
    business_id, client_id: client.id, amount, net_amount: amount,
    method: normalizedMethod as any, paid_at: new Date().toISOString(),
    notes: 'Registrado por voz — Luis IA',
  })

  if (error) {
    logger.error('TOOL-DB', `register_payment failed: ${error.message}`, { business_id })
    return 'No pude registrar el cobro.'
  }
  return `Listo. Registré un cobro de $${amount.toLocaleString('es-CO')} a ${client.name}.`
}

// ── STRATEGIC: Clientes Inactivos ─────────────────────────────────────────
export async function get_inactive_clients(business_id: string): Promise<string> {
  const supabase = await createClient()
  const sixtyDaysAgo = addDays(new Date(), -60).toISOString()

  // New V4 Optimized: Using RPC to avoid loading thousands of appts into memory
  const { data: inactive, error } = await supabase
    .rpc('get_inactive_clients_rpc', { 
      biz_id: business_id, 
      sixty_days_ago: sixtyDaysAgo 
    })

  if (error) {
    logger.error('TOOL-DB', `get_inactive_clients RPC failed: ${error.message}`, { business_id })
    return 'Error consultando clientes (High Load).'
  }

  if (!inactive?.length) return '¡Excelente! Todos tus clientes han venido en los últimos 2 meses.'
  
  const names = inactive.map(c => c.name).join(', ')
  return `He identificado a ${inactive.length} clientes inactivos por más de 60 días: ${names}. Podrías enviarles un WhatsApp de reactivación.`
}

// ── STRATEGIC: Estadísticas ──────────────────────────────────────────────
export async function get_revenue_stats(business_id: string): Promise<string> {
  const supabase = await createClient()
  const startCurrent = addDays(new Date(), -7).toISOString()
  const startPrev = addDays(new Date(), -14).toISOString()

  const { data: txs, error } = await supabase
    .from('transactions').select('net_amount, paid_at').eq('business_id', business_id).gte('paid_at', startPrev)

  if (error) return 'Error al calcular estadísticas.'
  const currentTotal = txs.filter(t => t.paid_at && new Date(t.paid_at) >= new Date(startCurrent)).reduce((acc, t) => acc + Number(t.net_amount), 0)
  const previousTotal = txs.filter(t => t.paid_at && new Date(t.paid_at) < new Date(startCurrent)).reduce((acc, t) => acc + Number(t.net_amount), 0)

  let diffStr = ''
  if (previousTotal > 0) {
    const diff = ((currentTotal - previousTotal) / previousTotal) * 100
    diffStr = ` — eso es un ${diff.toFixed(1)}% ${diff >= 0 ? 'más' : 'menos'} que la semana pasada.`
  }

  return `En los últimos 7 días has facturado $${currentTotal.toLocaleString('es-CO')}${diffStr}`
}

// ── STRATEGIC: WhatsApp CRM ──────────────────────────────────────────────
export async function send_reactivation_message(business_id: string, client_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()
  
  // 🛑 SECURITY: Multi-tenant ownership check
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, business_id')
    .eq('id', client_id)
    .single()

  if (clientErr || !client || client.business_id !== business_id) {
    logger.error('S-TOOL', `Ownership breach attempt: Client ${client_id} vs Biz ${business_id}`)
    return 'Error de permisos: El cliente no pertenece a este negocio.'
  }

  const [cliRes, busRes] = await Promise.all([
    supabase.from('clients').select('name, phone').eq('business_id', business_id).eq('name', client_name).single(),
    supabase.from('businesses').select('name').eq('id', business_id).single()
  ])

  if (cliRes.error || !cliRes.data.phone || busRes.error) return `No pude completar el envío para ${client_name}.`

  const result = await sendReactivationMessage({ to: cliRes.data.phone, clientName: cliRes.data.name, businessName: busRes.data.name })
  if (!result.success) return `Error al enviar WhatsApp: ${result.error}`

  return `Listo. Envié el WhatsApp de reactivación a ${client_name}.`
}

// ── STRATEGIC: Proyecciones Financieras (CFO Advanced) ───────────────────
export async function get_monthly_forecast(business_id: string): Promise<string> {
  const supabase = await createClient()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

  // 1. Obtener citas agendadas para el resto del mes (Confirmed only)
  const { data: appts, error } = await supabase
    .from('appointments')
    .select('id, service_id')
    .eq('business_id', business_id)
    .gte('start_at', now.toISOString())
    .lte('start_at', endOfMonth)
    .in('status', ['pending', 'confirmed']) // Only active commitments

  if (error) return 'Error al calcular la proyección mensual.'

  // 2. Obtener precios de servicios
  const { data: services } = await supabase
    .from('services')
    .select('id, price')
    .eq('business_id', business_id)

  if (!services) return 'No pude obtener los precios de los servicios.'

  // 3. Calcular
  const projectedRevenue = (appts ?? []).reduce((acc, a) => {
    const svc = services.find(s => s.id === a.service_id)
    return acc + Number(svc?.price ?? 0)
  }, 0)

  // 4. Obtener lo ya facturado este mes
  const { data: txs } = await supabase
    .from('transactions')
    .select('net_amount')
    .eq('business_id', business_id)
    .gte('paid_at', startOfMonth)
    .lte('paid_at', now.toISOString())

  const actualRevenue = (txs ?? []).reduce((acc, t) => acc + Number(t.net_amount), 0)
  const totalMonth = actualRevenue + projectedRevenue

  const monthName = format(now, 'MMMM', { locale: es })
  return `Para el mes de ${monthName}, ya has facturado $${actualRevenue.toLocaleString('es-CO')}. Basado en las citas agendadas faltantes, proyectamos cerrar el mes con un total de $${totalMonth.toLocaleString('es-CO')}.`
}
