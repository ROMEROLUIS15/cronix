import { createAdminClient } from './db.ts'
import type { AppointmentWithClient, BusinessRow } from '../types.ts'

export function buildReminderNotification(
  appointments: AppointmentWithClient[]
): { title: string; content: string; type: string; metadata: Record<string, unknown> } {
  const MAX_LISTED = 5
  const listed = appointments.slice(0, MAX_LISTED).map(apt => {
    const clientName = apt.clients?.name ?? 'Cliente'
    const serviceName = apt.services?.name ?? 'Servicio'
    const time = new Date(apt.start_at).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit',
    })
    return `${time} · ${clientName} — ${serviceName}`
  })

  const overflow = appointments.length > MAX_LISTED ? `\n+${appointments.length - MAX_LISTED} más` : ''

  return {
    title: `📋 ${appointments.length} recordatorio${appointments.length > 1 ? 's' : ''} enviado${appointments.length > 1 ? 's' : ''}`,
    content: listed.join('\n') + overflow,
    type: 'info',
    metadata: { event: 'reminder.sent', totalAppointments: appointments.length },
  }
}

export function buildWhatsAppFailureNotification(
  failedAppointments: AppointmentWithClient[]
): { title: string; content: string; type: string; metadata: Record<string, unknown> } | null {
  if (failedAppointments.length === 0) return null

  if (failedAppointments.length === 1) {
    return {
      title: '❌ Fallo al enviar recordatorio',
      content: `No se pudo enviar recordatorio a ${failedAppointments[0]!.clients?.name || 'cliente'}`,
      type: 'error',
      metadata: { event: 'whatsapp.failed', failureCount: 1 },
    }
  }

  return {
    title: `❌ ${failedAppointments.length} recordatorios no enviados`,
    content: `No se pudieron entregar ${failedAppointments.length} recordatorios por WhatsApp. Verifica la configuración.`,
    type: 'error',
    metadata: { event: 'whatsapp.multiple_failed', failureCount: failedAppointments.length },
  }
}

export async function insertNotification(
  businessId: string,
  payload: { title: string; content: string; type: string; metadata: Record<string, unknown> }
): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('notifications').insert([{
    business_id: businessId,
    title: payload.title,
    content: payload.content,
    type: payload.type,
    metadata: payload.metadata,
    is_read: false,
  }])
}

export async function sendPushNotification(
  business: BusinessRow,
  appointments: AppointmentWithClient[],
  cronSecret: string
): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const timezone = business.timezone ?? 'UTC'
  const pushUrl = `${supabaseUrl}/functions/v1/push-notify`

  const MAX_LISTED = 5
  const listed = appointments.slice(0, MAX_LISTED).map(apt => {
    const clientName = apt.clients?.name ?? 'Cliente'
    const serviceName = apt.services?.name ?? 'Servicio'
    const time = new Date(apt.start_at).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit', timeZone: timezone,
    })
    return `${time} · ${clientName} — ${serviceName}`
  })

  const overflow = appointments.length > MAX_LISTED ? `\n+${appointments.length - MAX_LISTED} más` : ''

  try {
    await fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': cronSecret,
      },
      body: JSON.stringify({
        business_id: business.id,
        title: `📋 ${appointments.length} cita${appointments.length > 1 ? 's' : ''} para mañana`,
        body: listed.join('\n') + overflow,
        url: '/dashboard',
      }),
    })
    return true
  } catch {
    return false
  }
}
