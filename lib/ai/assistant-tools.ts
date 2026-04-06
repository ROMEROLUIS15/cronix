import { createClient } from '@/lib/supabase/server'
import { startOfDay, endOfDay, format, addDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { fuzzyFind } from './fuzzy-match'
import { logger } from '@/lib/logger'
import { sendReactivationMessage } from '@/lib/services/whatsapp.service'

/**
 * Converts a UTC ISO string to a Date object that, when formatted with date-fns
 * (which ignores timezone), displays the correct local time for the given IANA timezone.
 * Uses native Intl — no extra packages needed.
 */
function toUserDate(isoString: string, timezone: string): Date {
  try {
    const utc = new Date(isoString)
    const utcMs = new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    const tzMs  = new Date(utc.toLocaleString('en-US', { timeZone: timezone })).getTime()
    return new Date(utc.getTime() + (tzMs - utcMs))
  } catch {
    return new Date(isoString)
  }
}

function fmtUserDate(isoString: string, timezone: string, fmt: string): string {
  return format(toUserDate(isoString, timezone), fmt, { locale: es })
}

/**
 * assistant-tools.ts — Server-side tools for the "Luis" AI Executive Assistant.
 * 
 * V4 Evolution: Multi-staff support & Actionable CRM.
 */

// ── READ: Obtener servicios (Para identificar qué se ofrece) ──────────────────
export async function get_services(business_id: string): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, duration_min')
    .eq('business_id', business_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return 'Error al obtener la lista de servicios.'
  if (!data || data.length === 0) return 'No hay servicios registrados en este negocio.'

  const list = data.map(s => `- ${s.name} ($${s.price}, ${s.duration_min} min)`).join('\n')
  return `Servicios disponibles:\n${list}`
}

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
    return 'Error al consultar los ingresos de hoy. Intenta de nuevo en un momento.'
  }
  if (apptRes.error) {
    logger.error('TOOL-DB', `get_today_summary appointments failed: ${apptRes.error.message}`, { business_id })
    return 'Error al consultar las citas de hoy. Intenta de nuevo en un momento.'
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
export async function get_upcoming_gaps(business_id: string, timezone: string = 'UTC'): Promise<string> {
  const supabase = await createClient()
  const todayStart = startOfDay(new Date()).toISOString()
  const todayEnd = endOfDay(new Date()).toISOString()

  const { data: appts, error } = await supabase
    .from('appointments').select('start_at, end_at').eq('business_id', business_id)
    .in('status', ['pending', 'confirmed']).gte('start_at', todayStart).lte('start_at', todayEnd)
    .order('start_at', { ascending: true })

  if (error) {
    logger.error('TOOL-DB', `get_upcoming_gaps failed: ${error.message}`, { business_id })
    return 'Error al consultar la agenda de hoy. Intenta de nuevo en un momento.'
  }
  if (!appts?.length) return 'Toda la agenda de hoy está libre, no hay citas programadas.'

  const fmt = (d: string) => fmtUserDate(d, timezone, 'h:mm a')
  const bloques = appts.map(a => `${fmt(a.start_at)} a ${fmt(a.end_at)}`)
  return `Los bloques OCUPADOS hoy son: ${bloques.join(', ')}. El resto del horario está disponible.`
}

// ── READ: Deuda de un cliente ──────────────────────────────────────────────
export async function get_client_debt(business_id: string, client_name: string): Promise<string> {
  const supabase = await createClient()

  const { data: clients, error } = await supabase
    .from('clients').select('id, name, phone').eq('business_id', business_id).is('deleted_at', null).limit(200)

  if (error) {
    logger.error('TOOL-DB', `get_client_debt failed: ${error.message}`, { business_id, client_name })
    return 'Error al buscar información del cliente. Intenta de nuevo en un momento.'
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

// ── READ: Citas próximas de un cliente ────────────────────────────────────
export async function get_client_appointments(business_id: string, client_name: string, timezone: string = 'UTC'): Promise<string> {
  const supabase = await createClient()

  const { data: clients, error: cliErr } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null).limit(200)

  if (cliErr) return 'Error al buscar el cliente.'

  const result = fuzzyFind(clients ?? [], client_name)
  if (result.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (result.status === 'ambiguous') return `Encontré varios clientes parecidos: ${result.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client = result.match as { id: string; name: string }

  const { data: appts, error } = await supabase
    .from('appointments')
    .select('id, start_at, end_at, services:service_id(name), users:assigned_user_id(name)')
    .eq('business_id', business_id)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(10)

  if (error) return 'Error al consultar las citas del cliente.'
  if (!appts?.length) return `${client.name} no tiene citas próximas activas.`

  const list = appts.map(a => {
    const serviceName = (a.services as any)?.name || 'Servicio sin especificar'
    const staffName   = (a.users as any)?.name
    const dateStr     = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
    return `- ${serviceName} el ${dateStr}${staffName ? ` con ${staffName}` : ''}`
  }).join('\n')

  return `Citas próximas de ${client.name}:\n${list}`
}

// ── WRITE: Cancelar cita ──────────────────────────────────────────────────
export async function cancel_appointment(
  business_id: string,
  client_name: string,
  appointment_date?: string,
  timezone: string = 'UTC'
): Promise<string> {
  const supabase = await createClient()

  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null).limit(200)
  const result = fuzzyFind(clients ?? [], client_name)

  if (result.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (result.status === 'ambiguous') return `Encontré varios clientes parecidos: ${result.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client = result.match as { id: string; name: string }
  const now = new Date().toISOString()

  const { data: appts, error: apptErr } = await supabase
    .from('appointments')
    .select('id, start_at, services:service_id(name)')
    .eq('business_id', business_id)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', now)
    .order('start_at', { ascending: true })

  if (apptErr) {
    logger.error('TOOL-DB', `cancel_appointment query failed: ${apptErr.message}`, { business_id })
    return 'Error al buscar las citas del cliente.'
  }
  if (!appts?.length) return `${client.name} no tiene citas próximas activas.`

  let target = appts[0]

  if (appointment_date) {
    // Target the appointment on the specified day
    const dayStart = startOfDay(parseISO(appointment_date))
    const dayEnd   = endOfDay(parseISO(appointment_date))
    const found = appts.find(a => {
      const d = new Date(a.start_at)
      return d >= dayStart && d <= dayEnd
    })
    if (!found) return `No encontré una cita de ${client.name} para esa fecha. Consulta sus citas próximas para confirmar la fecha correcta.`
    target = found
  } else if (appts.length > 1) {
    const list = appts.map(a => {
      const svc     = (a.services as any)?.name || 'Servicio'
      const dateStr = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
      return `- ${svc} el ${dateStr}`
    }).join('\n')
    return `${client.name} tiene varias citas próximas:\n${list}\n¿Cuál deseas cancelar?`
  }

  const serviceName = (target.services as any)?.name || 'servicio'
  const dateStr     = fmtUserDate(target.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
  const nowIso      = new Date().toISOString()

  const { error: updErr } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso })
    .eq('id', target.id)

  if (updErr) {
    logger.error('TOOL-DB', `cancel_appointment update failed: ${updErr.message}`, { business_id, apt_id: target.id })
    return 'No pude cancelar la cita por un error técnico.'
  }

  return `Listo. Cancelé la cita de ${client.name} (${serviceName}) del ${dateStr}.`
}


// ── WRITE: Agendar cita (Multi-Staff) ─────────────────────────────────────
export async function book_appointment(
  business_id: string,
  client_name: string,
  service_name: string,
  date: string,
  staff_name?: string,
  timezone: string = 'UTC'
): Promise<string> {
  const supabase = await createClient()

  // 🛑 SECURITY & PRECISION: Check if the date string contains a time (e.g. "T10:00" or similar)
  // Regular dates (YYYY-MM-DD) result in 00:00:00 which is often an error for a business appointment.
  const hasTime = date.includes('T') || date.includes(':') || /\d\s?(am|pm)/i.test(date)
  if (!hasTime) {
    return 'Error: No proporcionaste una hora específica. Por favor, pregunta al usuario a qué hora desea la cita antes de agendar.'
  }

  const apptDate = parseISO(date)
  if (isNaN(apptDate.getTime())) return 'La fecha proporcionada no es válida.'
  
  const now = new Date()
  if (apptDate < addDays(now, -365)) {
    return 'No puedo agendar citas con más de un año de antigüedad por seguridad.'
  }

  const [cliRes, svcRes] = await Promise.all([
    supabase.from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null).limit(200),
    supabase.from('services').select('id, name, duration_min').eq('business_id', business_id).eq('is_active', true)
  ])

  const clientResult = fuzzyFind(cliRes.data ?? [], client_name)
  const serviceResult = fuzzyFind(svcRes.data ?? [], service_name)

  if (clientResult.status !== 'found') return `No encontré al cliente ${client_name}.`
  if (serviceResult.status !== 'found') return `No encontré el servicio ${service_name}.`

  const client = clientResult.match
  const service = serviceResult.match as { id: string; name: string; duration_min: number }

  let staff: { id: string; name: string } | null = null
  if (staff_name) {
    const { data: team } = await supabase
      .from('users')
      .select('id, name, role')
      .eq('business_id', business_id)
      .in('role', ['owner', 'employee'])
      .eq('is_active', true)
    const staffMatch = fuzzyFind(team ?? [], staff_name)
    if (staffMatch.status === 'found') staff = staffMatch.match as { id: string; name: string }
  }

  const startISO = date
  const startMs  = new Date(startISO).getTime()
  const durationMin = service.duration_min ?? 60
  const endISO   = new Date(startMs + durationMin * 60_000).toISOString()

  // Availability check: prevent double-booking
  const { data: conflicts } = await supabase
    .from('appointments')
    .select('id')
    .eq('business_id', business_id)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', endISO)
    .gt('end_at', startISO)

  if (conflicts && conflicts.length > 0) {
    return `Ese horario ya está ocupado, hay ${conflicts.length} cita(s) que se solapan. Sugiere al usuario otro horario o consulta los espacios disponibles.`
  }

  const { data: row, error } = await supabase
    .from('appointments')
    .insert({
      business_id,
      client_id:        client.id,
      service_id:       service.id,
      assigned_user_id: staff?.id || null, 
      start_at:         startISO,
      end_at:           endISO,
      status:           'pending' 
    })
    .select()
    .single()

  if (error || !row) {
    logger.error('TOOL-DB', `book_appointment failed: ${error?.message}`, { business_id, client_id: client.id })
    return 'Hubo un error técnico al crear la cita en la base de datos.'
  }

  await supabase.from('appointment_services').insert({ appointment_id: row.id, service_id: service.id, sort_order: 0 })

  const staffStr = staff_name ? ` con ${staff_name}` : ''
  return `Listo. Agendé a ${client.name} para ${service.name}${staffStr} el ${fmtUserDate(row.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")}.`
}

// ── WRITE: Reagendar cita (Atómica: update in-place) ─────────────────────
export async function reschedule_appointment(
  business_id: string,
  client_name: string,
  new_date: string,
  old_date?: string,
  timezone: string = 'UTC'
): Promise<string> {
  const supabase = await createClient()

  const hasTime = new_date.includes('T') || new_date.includes(':') || /\d\s?(am|pm)/i.test(new_date)
  if (!hasTime) {
    return 'Error: No proporcionaste una hora específica para la nueva cita. Pregunta al usuario a qué hora desea reagendar.'
  }

  const newApptDate = parseISO(new_date)
  if (isNaN(newApptDate.getTime())) return 'La nueva fecha proporcionada no es válida.'

  const { data: clients } = await supabase
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null).limit(200)
  const clientResult = fuzzyFind(clients ?? [], client_name)
  if (clientResult.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (clientResult.status === 'ambiguous') return `Encontré varios clientes parecidos: ${clientResult.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client = clientResult.match
  const now = new Date().toISOString()

  const { data: appts, error: apptErr } = await supabase
    .from('appointments')
    .select('id, start_at, service_id, assigned_user_id, services:service_id(name, duration_min)')
    .eq('business_id', business_id)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', now)
    .order('start_at', { ascending: true })

  if (apptErr) {
    logger.error('TOOL-DB', `reschedule_appointment query failed: ${apptErr.message}`, { business_id })
    return 'Error al buscar las citas del cliente.'
  }
  if (!appts?.length) return `${client.name} no tiene citas próximas activas para reagendar.`

  let oldAppt = appts[0]

  if (old_date) {
    const dayStart = startOfDay(parseISO(old_date))
    const dayEnd   = endOfDay(parseISO(old_date))
    const found = appts.find(a => {
      const d = new Date(a.start_at)
      return d >= dayStart && d <= dayEnd
    })
    if (!found) return `No encontré una cita de ${client.name} para esa fecha. Consulta sus citas próximas para confirmar la fecha correcta.`
    oldAppt = found
  } else if (appts.length > 1) {
    const list = appts.map(a => {
      const svc     = (a.services as any)?.name || 'Servicio'
      const dateStr = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
      return `- ${svc} el ${dateStr}`
    }).join('\n')
    return `${client.name} tiene varias citas próximas:\n${list}\n¿Cuál deseas reagendar?`
  }

  const serviceName = (oldAppt.services as any)?.name || 'servicio'
  const durationMin = (oldAppt.services as any)?.duration_min || 60
  const newStartISO = new_date
  const newEndISO   = new Date(new Date(newStartISO).getTime() + durationMin * 60_000).toISOString()

  const { data: conflicts } = await supabase
    .from('appointments')
    .select('id')
    .eq('business_id', business_id)
    .in('status', ['pending', 'confirmed'])
    .neq('id', oldAppt.id)
    .lt('start_at', newEndISO)
    .gt('end_at', newStartISO)

  if (conflicts && conflicts.length > 0) {
    return `Ese horario ya está ocupado. Hay ${conflicts.length} cita(s) que se solapan. Sugiere otro horario al usuario.`
  }

  const { error: updErr } = await supabase
    .from('appointments')
    .update({ start_at: newStartISO, end_at: newEndISO, status: 'pending', updated_at: now })
    .eq('id', oldAppt.id)

  if (updErr) {
    logger.error('TOOL-DB', `reschedule_appointment update failed: ${updErr.message}`, { business_id, apt_id: oldAppt.id })
    return 'No pude reagendar la cita por un error técnico.'
  }

  const oldDateStr = fmtUserDate(oldAppt.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
  const newDateStr = fmtUserDate(newStartISO, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
  return `Listo. Reagendé la cita de ${client.name} (${serviceName}) del ${oldDateStr} al ${newDateStr}.`
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
    .from('clients').select('id, name').eq('business_id', business_id).is('deleted_at', null).limit(200)
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

// ── WRITE: Crear cliente nuevo ────────────────────────────────────────────
export async function create_client(
  business_id: string,
  client_name: string,
  phone: string,
  email?: string
): Promise<string> {
  const supabase = await createClient()

  // 1. Cargar todos los clientes y verificar duplicados con fuzzy match
  const { data: existing, error: listErr } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('business_id', business_id)
    .is('deleted_at', null)
    .limit(200)

  if (listErr) {
    logger.error('TOOL-DB', `create_client list failed: ${listErr.message}`, { business_id })
    return 'Error: no pude verificar si el cliente ya existe. Intenta de nuevo.'
  }

  const duplicate = fuzzyFind(existing ?? [], client_name)
  if (duplicate.status === 'found') {
    const d = duplicate.match as { id: string; name: string; phone: string | null }
    return `El cliente "${d.name}"${d.phone ? ` (Tel: ${d.phone})` : ''} ya está registrado. No se creó un duplicado.`
  }

  // 2. Crear el cliente
  const { data: row, error } = await supabase
    .from('clients')
    .insert({
      business_id,
      name:  client_name.trim(),
      phone: phone.trim(),
      ...(email ? { email: email.trim() } : {}),
    })
    .select('id, name, phone')
    .single()

  if (error || !row) {
    logger.error('TOOL-DB', `create_client insert failed: ${error?.message}`, { business_id })
    return 'Error: no pude registrar el cliente. Intenta de nuevo o verifica los datos.'
  }

  return `Listo. Cliente "${row.name}" registrado correctamente.`
}

// ── READ: Listar Clientes (NUEVO) ──────────────────────────────────────────
export async function get_clients(business_id: string, query?: string): Promise<string> {
  const supabase = await createClient()
  let dbQuery = supabase.from('clients').select('id, name, phone, email').eq('business_id', business_id).is('deleted_at', null)

  if (query) {
    dbQuery = dbQuery.ilike('name', `%${query}%`)
  }

  const { data, error: cliErr } = await dbQuery.order('name', { ascending: true }).limit(200)

  if (cliErr) {
    logger.error('TOOL-DB', `get_clients failed: ${cliErr.message}`, { business_id })
    return 'Error al consultar la lista de clientes. Intenta de nuevo en un momento.'
  }
  if (!data?.length) return 'No tienes clientes registrados aún.'

  const clients = data as Array<{ id: string; name: string; phone: string | null }>

  // 🌟 SENIOR FIX: If there's a query, use our smart fuzzyFind instead of strict SQL
  if (query) {
    const result = fuzzyFind(clients, query)
    if (result.status === 'found') {
      const c = result.match
      return `He encontrado a ${c.name}${c.phone ? ` (Tel: ${c.phone})` : ''}. ¿Es a quien te refieres?`
    }
    if (result.status === 'ambiguous') {
      const candidates = result.candidates.map(c => `- ${c.name}`).join('\n')
      return `Encontré varios clientes parecidos a "${query}":\n${candidates}\n¿Cuál de ellos es?`
    }
    return `No encontré ningún cliente llamado "${query}". ¿Te gustaría que lo registre?`
  }

  const list = clients.map(c => `- ${c.name}${c.phone ? ` (Tel: ${c.phone})` : ''}`).join('\n')
  return `Aquí tienes a tus clientes registrados:\n${list}`
}

// ── READ: Listar Empleados/Staff (NUEVO) ─────────────────────────────────────
export async function get_staff(business_id: string, query?: string): Promise<string> {
  const supabase = await createClient()
  const { data: staff, error } = await supabase
    .from('users')
    .select('id, name, role')
    .eq('business_id', business_id)
    .in('role', ['owner', 'employee'])
    .order('name', { ascending: true })

  if (error) {
    logger.error('TOOL-DB', `get_staff failed: ${error.message}`, { business_id })
    return 'Error al consultar el equipo de trabajo. Intenta de nuevo en un momento.'
  }
  if (!staff?.length) return 'No tienes empleados registrados aún.'

  const team = staff as Array<{ id: string; name: string; role: string }>

  // 🌟 SENIOR FIX: Fuzzy search for staff too
  if (query) {
    const result = fuzzyFind(team, query)
    if (result.status === 'found') {
      const s = result.match
      return `He encontrado a ${s.name} (${s.role === 'owner' ? 'Dueño' : 'Empleado'}). ¿Es a quien buscas?`
    }
    if (result.status === 'ambiguous') {
      const candidates = result.candidates.map(c => `- ${c.name}`).join('\n')
      return `Encontré varios empleados parecidos a "${query}":\n${candidates}\n¿Cuál de ellos es?`
    }
    return `No encontré ningún empleado llamado "${query}".`
  }

  const list = team.map(s => `- ${s.name} (${s.role === 'owner' ? 'Dueño' : 'Empleado'})`).join('\n')
  return `Aquí tienes al equipo de trabajo:\n${list}`
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
  
  // 🛑 SECURITY: Multi-tenant ownership check & Data Fetch
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, phone, business_id')
    .eq('id', client_id)
    .single()

  if (clientErr || !client || client.business_id !== business_id) {
    logger.error('S-TOOL', `Ownership breach or missing client: ${client_id} vs Biz ${business_id}`)
    return 'Error de permisos o cliente no encontrado.'
  }

  const { data: busRes, error: busErr } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', business_id)
    .single()

  if (busErr || !busRes) return `No pude obtener los datos del negocio para ${client_name}.`
  if (!client.phone) return `El cliente ${client.name} no tiene un número de teléfono registrado.`

  const result = await sendReactivationMessage({ 
    to: client.phone, 
    clientName: client.name, 
    businessName: busRes.name 
  })

  if (!result.success) {
    logger.error('TOOL-WA', `send_reactivation_message failed: ${result.error}`, { business_id, client_id })
    return 'No pude enviar el mensaje de WhatsApp en este momento. Intenta de nuevo más tarde.'
  }

  return `Listo. Envié el WhatsApp de reactivación a ${client.name}.`
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
