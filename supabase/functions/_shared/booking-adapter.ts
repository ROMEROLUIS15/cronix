/**
 * booking-adapter.ts — WhatsApp booking implementation (Deno-compatible).
 *
 * One of three per-channel booking implementations (see ADR-0006). The shared
 * contract across channels is the database (RPCs + appointments constraints),
 * not a shared engine.
 *
 * DIFERENCIAS con el canal dashboard:
 *   - El cliente se identifica por TELÉFONO, no por nombre
 *   - El businessId viene del webhook (verificado por HMAC de Meta), no del LLM
 *   - No hay auto-creación por nombre: el RPC fn_book_appointment_wa crea el cliente
 *     por teléfono si no existe (comportamiento existente preservado)
 *
 * NOTA: Deno-compatible (sin imports de Node.js). La creación va por RPC
 * (fn_book_appointment_wa / fn_reschedule_appointment_wa), que encapsula
 * conflict-check y manejo de cliente por teléfono. Cancel/read usan el cliente
 * de Supabase directamente con filtro de tenant.
 */

import { createClient } from '@supabase/supabase-js'

// ── Tipos locales (Deno no puede importar de lib/) ────────────────────────────

type ToolErrorCode =
  | 'SLOT_CONFLICT' | 'CLIENT_NOT_FOUND' | 'APPOINTMENT_NOT_FOUND'
  | 'UNAUTHORIZED' | 'BOOKING_RATE_LIMIT' | 'INVALID_ARGS' | 'DB_ERROR'

type ToolResult =
  | { success: true;  message: string; appointmentId?: string; serviceName?: string; date?: string; time?: string }
  | { success: false; error: ToolErrorCode; message: string }

type ServiceRow = { id: string; name: string; duration_min: number; price: number }
type ActiveAppointmentRow = { id: string; service_name: string; start_at: string }

// ── Timezone (puro Intl — mismo algoritmo Intl usado en los demás canales) ──

function localToUTC(date: string, time: string, timezone: string): string {
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)
  const tzStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(naiveAsUTC)
  const tzAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  return new Date(naiveAsUTC.getTime() + (naiveAsUTC.getTime() - tzAsUTC.getTime())).toISOString()
}

function utcToLocalParts(utcIso: string, timezone: string): { date: string; time: string } {
  const d = new Date(utcIso)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const hour = map.hour === '24' ? '00' : map.hour
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${hour}:${map.minute}` }
}

function normalizeTime(raw: string): string | null {
  const t = raw.trim()
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return t
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i)
  if (!m) return null
  let h = parseInt(m[1]!, 10)
  const min = m[2] ?? '00'
  const p = m[3]?.toUpperCase()
  if (p === 'PM' && h < 12) h += 12
  if (p === 'AM' && h === 12) h = 0
  if (h > 23) return null
  return `${h.toString().padStart(2, '0')}:${min}`
}

function sanitizeUUID(id: string | undefined): string {
  return (id ?? '').replace(/^(?:REF#?|ID#?)\s*/i, '').trim()
}

// ── WhatsAppBookingAdapter ────────────────────────────────────────────────────

export class WhatsAppBookingAdapter {
  private supabase: ReturnType<typeof createClient>

  constructor(
    supabaseUrl:   string,
    serviceRoleKey: string,
  ) {
    this.supabase = createClient(supabaseUrl, serviceRoleKey)
  }

  /**
   * Punto de entrada: el agente WhatsApp llama esto con el tool name + args crudos.
   *
   * @param toolName    El nombre del tool que el LLM quiere ejecutar
   * @param rawArgs     Args del LLM (objeto parseado de JSON)
   * @param businessId  ID del negocio — viene del webhook, verificado por HMAC
   * @param timezone    IANA timezone del negocio
   * @param senderPhone Número de WhatsApp del remitente (identidad del cliente)
   * @param services    Catálogo de servicios del negocio (ya cargado en contexto)
   * @param activeAppts Citas activas del cliente (ya cargadas en contexto)
   */
  async execute(params: {
    toolName:     string
    rawArgs:      Record<string, string>
    businessId:   string
    timezone:     string
    senderPhone:  string
    services:     ServiceRow[]
    activeAppts:  ActiveAppointmentRow[]
  }): Promise<ToolResult> {
    const { toolName, rawArgs, businessId, timezone, senderPhone, services, activeAppts } = params

    switch (toolName) {
      case 'confirm_booking':
        return this.confirmBooking({ rawArgs, businessId, timezone, senderPhone, services })
      case 'cancel_booking':
        return this.cancelBooking({ rawArgs, businessId, timezone, senderPhone, activeAppts })
      case 'reschedule_booking':
        return this.rescheduleBooking({ rawArgs, businessId, timezone, senderPhone, activeAppts })
      default:
        return { success: false, error: 'INVALID_ARGS', message: `Tool "${toolName}" no disponible en este canal.` }
    }
  }

  // ── confirm_booking ──────────────────────────────────────────────────────────

  private async confirmBooking(p: {
    rawArgs:     Record<string, string>
    businessId:  string
    timezone:    string
    senderPhone: string
    services:    ServiceRow[]
  }): Promise<ToolResult> {
    let { service_id, date, time } = p.rawArgs

    // Normalizar service_id: puede ser UUID o nombre
    service_id = sanitizeUUID(service_id)
    if (!/^[0-9a-f-]{36}$/i.test(service_id)) {
      const match = p.services.find((s) =>
        s.name.toLowerCase().includes(service_id.toLowerCase()) ||
        service_id.toLowerCase().includes(s.name.toLowerCase())
      )
      if (!match) return { success: false, error: 'INVALID_ARGS', message: `No encontré el servicio "${service_id}".` }
      service_id = match.id
    }

    const normalizedTime = normalizeTime(time)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito la fecha en formato YYYY-MM-DD.' }
    }
    if (!normalizedTime) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito la hora en formato HH:mm.' }
    }

    const startAt = localToUTC(date, normalizedTime, p.timezone)

    // Delegar al RPC que maneja la creación del cliente por teléfono atómicamente
    const { data, error } = await this.supabase.rpc('fn_book_appointment_wa', {
      p_business_id:  p.businessId,
      p_client_phone: p.senderPhone,
      p_client_name:  null,  // el RPC busca por teléfono, no por nombre
      p_service_id:   service_id,
      p_start_at:     startAt,
    })

    if (error) {
      return { success: false, error: 'DB_ERROR', message: 'Error interno al crear la cita.' }
    }

    const result = data as { success: boolean; error?: string; appointment_id?: string }
    if (!result.success) {
      if (result.error?.includes('SLOT_CONFLICT') || result.error?.includes('ocupado')) {
        return { success: false, error: 'SLOT_CONFLICT', message: `El horario ${normalizedTime} del ${date} ya está ocupado. ¿Quieres otro horario?` }
      }
      if (result.error?.includes('BOOKING_RATE_LIMIT')) {
        return { success: false, error: 'BOOKING_RATE_LIMIT', message: 'Ya tienes el máximo de citas activas. Cancela una antes de agendar.' }
      }
      return { success: false, error: 'DB_ERROR', message: result.error ?? 'No se pudo crear la cita.' }
    }

    const svcName = p.services.find((s) => s.id === service_id)?.name ?? 'el servicio'
    return {
      success:       true,
      message:       `Listo. Tu cita de ${svcName} quedó para el ${date} a las ${normalizedTime}.`,
      appointmentId: result.appointment_id,
      serviceName:   svcName,
      date,
      time:          normalizedTime,
    }
  }

  // ── cancel_booking ───────────────────────────────────────────────────────────

  private async cancelBooking(p: {
    rawArgs:     Record<string, string>
    businessId:  string
    timezone:    string
    senderPhone: string
    activeAppts: ActiveAppointmentRow[]
  }): Promise<ToolResult> {
    const appointmentId = sanitizeUUID(p.rawArgs['appointment_id'])
    if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito el ID exacto de la cita (sin prefijo REF#).' }
    }

    // Verificar ownership: la cita debe pertenecer a este negocio y cliente
    const target = p.activeAppts.find((a) => a.id === appointmentId)
    if (!target) {
      return {
        success: false,
        error:   'APPOINTMENT_NOT_FOUND',
        message: 'No encontré esa cita en tus citas activas. Verifica el ID.',
      }
    }

    const { error } = await this.supabase
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', appointmentId)
      .eq('business_id', p.businessId)

    if (error) return { success: false, error: 'DB_ERROR', message: 'Error al cancelar la cita.' }

    const { date, time } = utcToLocalParts(target.start_at, p.timezone)
    return {
      success:     true,
      message:     `Listo. Cancelé tu cita de ${target.service_name}.`,
      appointmentId,
      serviceName: target.service_name,
      date,
      time,
    }
  }

  // ── reschedule_booking ───────────────────────────────────────────────────────

  private async rescheduleBooking(p: {
    rawArgs:     Record<string, string>
    businessId:  string
    timezone:    string
    senderPhone: string
    activeAppts: ActiveAppointmentRow[]
  }): Promise<ToolResult> {
    const appointmentId = sanitizeUUID(p.rawArgs['appointment_id'])
    const new_date = p.rawArgs['new_date'] ?? ''
    const new_time = normalizeTime(p.rawArgs['new_time'] ?? '')

    if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito el ID exacto de la cita.' }
    }
    if (!new_date || !/^\d{4}-\d{2}-\d{2}$/.test(new_date)) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito la nueva fecha (YYYY-MM-DD).' }
    }
    if (!new_time) {
      return { success: false, error: 'INVALID_ARGS', message: 'Necesito la nueva hora (HH:mm).' }
    }

    const target = p.activeAppts.find((a) => a.id === appointmentId)
    if (!target) {
      return { success: false, error: 'APPOINTMENT_NOT_FOUND', message: 'No encontré esa cita en tus citas activas.' }
    }

    const newStartAt = localToUTC(new_date, new_time, p.timezone)

    const { data, error } = await this.supabase.rpc('fn_reschedule_appointment_wa', {
      p_appointment_id: appointmentId,
      p_business_id:    p.businessId,
      p_new_start_at:   newStartAt,
    })

    if (error) return { success: false, error: 'DB_ERROR', message: 'Error al reagendar la cita.' }

    const result = data as { success: boolean; error?: string }
    if (!result.success) {
      if (result.error?.includes('SLOT_CONFLICT')) {
        return { success: false, error: 'SLOT_CONFLICT', message: `El horario ${new_time} del ${new_date} ya está ocupado. ¿Quieres otro horario?` }
      }
      return { success: false, error: 'DB_ERROR', message: result.error ?? 'No se pudo reagendar.' }
    }

    return {
      success:       true,
      message:       `Listo. Tu cita de ${target.service_name} queda para el ${new_date} a las ${new_time}.`,
      appointmentId,
      serviceName:   target.service_name,
      date:          new_date,
      time:          new_time,
    }
  }
}
