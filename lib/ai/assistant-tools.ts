import { createClient } from '@/lib/supabase/server'
import { startOfDay, endOfDay, format, addDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { fuzzyFind } from './fuzzy-match'

/**
 * assistant-tools.ts — Server-side tools for the "Luis" AI Executive Assistant.
 *
 * READ tools (safe — no mutations):
 *   get_today_summary   → Facturación + resumen de citas del día
 *   get_upcoming_gaps   → Horas libres hoy
 *   get_client_debt     → Pagos pendientes de un cliente
 *
 * WRITE tools (mutations — all isolated by business_id):
 *   cancel_appointment  → Cancela la próxima cita de un cliente
 *   book_appointment    → Agenda una nueva cita
 *   register_payment    → Registra un cobro/abono
 */

// ── READ: Resumen del día ──────────────────────────────────────────────────
export async function get_today_summary(business_id: string): Promise<string> {
  const supabase = await createClient()
  const todayStart = startOfDay(new Date()).toISOString()
  const todayEnd = endOfDay(new Date()).toISOString()

  const [incomeRes, apptRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('net_amount')
      .eq('business_id', business_id)
      .gte('paid_at', todayStart)
      .lte('paid_at', todayEnd),
    supabase
      .from('appointments')
      .select('status')
      .eq('business_id', business_id)
      .gte('start_at', todayStart)
      .lte('start_at', todayEnd),
  ])

  if (incomeRes.error) return `Error al consultar ingresos: ${incomeRes.error.message}`
  if (apptRes.error)   return `Error al consultar citas: ${apptRes.error.message}`

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
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', business_id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', todayStart)
    .lte('start_at', todayEnd)
    .order('start_at', { ascending: true })

  if (error) return `Error al consultar agenda: ${error.message}`
  if (!appts || appts.length === 0) return 'Toda la agenda de hoy está libre, no hay citas programadas.'

  const fmt = (d: string) => format(new Date(d), 'h:mm a')
  const bloques = appts.map(a => `${fmt(a.start_at)} a ${fmt(a.end_at)}`)
  return `Los bloques OCUPADOS hoy son: ${bloques.join(', ')}. El resto del horario está disponible.`
}

// ── READ: Deuda de un cliente ──────────────────────────────────────────────
export async function get_client_debt(business_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()

  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('business_id', business_id)
    .is('deleted_at', null)

  if (error) return `Error buscando clientes: ${error.message}`
  if (!clients?.length) return 'No tienes clientes registrados aún.'

  const result = fuzzyFind(clients, client_name)
  if (result.status === 'not_found') return `No encontré ningún cliente que se llame "${client_name}".`
  if (result.status === 'ambiguous') {
    const names = result.candidates.map(c => c.name).join(', ')
    return `Encontré varios clientes parecidos: ${names}. ¿A cuál te refieres?`
  }

  const client = result.match
  // Buscar citas sin pago asociado (potencial deuda)
  const { data: unpaid } = await supabase
    .from('appointments')
    .select('start_at, status')
    .eq('business_id', business_id)
    .eq('client_id', client.id)
    .eq('status', 'completed')
    .limit(5)

  if (!unpaid?.length) {
    return `El cliente ${client.name} no tiene citas completadas sin procesar. Está al día.`
  }

  return `El cliente ${client.name} (tel: ${client.phone}) tiene ${unpaid.length} cita(s) completada(s) recientes. Revisa si están pagadas en Finanzas.`
}

// ── WRITE: Cancelar la próxima cita de un cliente ────────────────────────-
export async function cancel_appointment(business_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()

  const { data: clients, error: cliErr } = await supabase
    .from('clients')
    .select('id, name')
    .eq('business_id', business_id)
    .is('deleted_at', null)

  if (cliErr) return `Error buscando clientes: ${cliErr.message}`
  if (!clients?.length) return 'No tienes clientes registrados.'

  const result = fuzzyFind(clients, client_name)
  if (result.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (result.status === 'ambiguous') {
    const names = result.candidates.map(c => c.name).join(', ')
    return `Encontré varios clientes con ese nombre: ${names}. ¿Cuál cancelo?`
  }

  const client = result.match
  const now = new Date().toISOString()

  const { data: appts, error: apptErr } = await supabase
    .from('appointments')
    .select('id, start_at')
    .eq('business_id', business_id)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', now)
    .order('start_at', { ascending: true })
    .limit(1)

  if (apptErr) return `Error buscando citas: ${apptErr.message}`
  const apt = appts[0]
  if (!apt) return `${client.name} no tiene citas próximas activas para cancelar.`

  const { error: updErr } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', apt.id)
    .eq('business_id', business_id)

  if (updErr) return `No pude cancelar la cita: ${updErr.message}`

  const dateStr = format(new Date(apt.start_at), "EEEE d 'de' MMMM 'a las' h:mm a", { locale: es })
  return `Listo. Cancelé la cita de ${client.name} del ${dateStr}.`
}

// ── WRITE: Agendar una cita nueva ─────────────────────────────────────────
export async function book_appointment(
  business_id: string,
  client_name: string,
  service_name: string,
  date: string, // 'YYYY-MM-DD' o 'mañana', 'hoy'
  time: string  // 'HH:MM' en 24h
): Promise<string> {
  const supabase = await createClient()

  // Resolver fecha relativa
  let dateObj = new Date()
  if (date === 'mañana' || date === 'manana') dateObj = addDays(new Date(), 1)
  else if (date !== 'hoy') {
    try { dateObj = parseISO(date) } catch { return `No entendí la fecha "${date}". Dime "hoy", "mañana" o una fecha como 2026-04-05.` }
  }
  const dateStr = format(dateObj, 'yyyy-MM-dd')

  // Buscar cliente
  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null)
  const clientResult = fuzzyFind(clients ?? [], client_name)
  if (clientResult.status === 'not_found') return `No encontré el cliente "${client_name}".`
  if (clientResult.status === 'ambiguous') {
    const names = clientResult.candidates.map(c => c.name).join(', ')
    return `Hay varios clientes parecidos: ${names}. ¿Cuál agendo?`
  }
  const client = clientResult.match

  // Buscar servicio
  const { data: services } = await supabase
    .from('services').select('id, name, duration_min').eq('business_id', business_id).eq('is_active', true)
  const svcResult = fuzzyFind(services ?? [], service_name)
  if (svcResult.status === 'not_found') return `No encontré el servicio "${service_name}". ¿Lo escribiste bien?`
  if (svcResult.status === 'ambiguous') {
    const names = svcResult.candidates.map(s => s.name).join(', ')
    return `Hay varios servicios parecidos: ${names}. ¿Cuál agendo?`
  }
  const service = svcResult.match as { id: string; name: string; duration_min: number }

  // Construir start_at y end_at
  const startISO = `${dateStr}T${time}:00`
  const startMs  = new Date(startISO).getTime()
  const endISO   = new Date(startMs + (service.duration_min ?? 60) * 60_000).toISOString()

  const { data: row, error } = await supabase
    .from('appointments')
    .insert({
      business_id,
      client_id:   client.id,
      service_id:  service.id,
      start_at:    new Date(startISO).toISOString(),
      end_at:      endISO,
      status:      'pending',
      is_dual_booking: false,
    })
    .select('id')
    .single()

  if (error || !row) return `No pude crear la cita: ${error?.message}`

  await supabase.from('appointment_services').insert({
    appointment_id: row.id,
    service_id:     service.id,
    sort_order:     0,
  })

  const prettyDate = format(new Date(startISO), "EEEE d 'de' MMMM 'a las' h:mm a", { locale: es })
  return `Perfecto. Agendé a ${client.name} para ${service.name} el ${prettyDate}. Cita creada exitosamente.`
}

// ── WRITE: Registrar un cobro/abono ───────────────────────────────────────
export async function register_payment(
  business_id: string,
  client_name: string,
  amount: number,
  method: string
): Promise<string> {
  const supabase = await createClient()

  // Normalizar método de pago
  const methodMap: Record<string, string> = {
    efectivo: 'cash', cash: 'cash',
    tarjeta: 'card', card: 'card',
    transferencia: 'transfer', transfer: 'transfer', zelle: 'transfer',
    qr: 'qr', 'pago movil': 'qr', 'pago móvil': 'qr',
  }
  const normalizedMethod = methodMap[method.toLowerCase()] ?? 'other'

  // Buscar cliente
  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null)
  const result = fuzzyFind(clients ?? [], client_name)
  if (result.status === 'not_found') return `No encontré el cliente "${client_name}".`
  if (result.status === 'ambiguous') {
    const names = result.candidates.map(c => c.name).join(', ')
    return `Hay varios clientes parecidos: ${names}. ¿A cuál le registro el cobro?`
  }
  const client = result.match

  const { error } = await supabase.from('transactions').insert({
    business_id,
    client_id:  client.id,
    amount,
    net_amount: amount,
    method:     normalizedMethod as 'cash' | 'card' | 'transfer' | 'qr' | 'other',
    paid_at:    new Date().toISOString(),
    notes:      `Registrado por voz — Asistente Luis`,
  })

  if (error) return `No pude registrar el cobro: ${error.message}`

  return `Listo. Registré un cobro de $${amount.toLocaleString('es-CO')} a ${client.name} por método ${method}. Queda guardado en Finanzas.`
}
