import { createAdminClient } from './db.ts'
import type { AppointmentWithClient, BusinessRow } from '../types.ts'

interface WhatsAppSendResult {
  sent: number
  failed: number
  failedAppointments: AppointmentWithClient[]
}

export async function sendWhatsAppReminders(
  business: BusinessRow,
  appointments: AppointmentWithClient[],
  skippedAptIds: Set<string>,
  cronSecret: string
): Promise<WhatsAppSendResult> {
  const settings = business.settings as Record<string, unknown> | null
  const whatsappEnabled =
    (settings?.notifications as Record<string, unknown>)?.whatsapp !== false

  if (!whatsappEnabled) {
    return { sent: 0, failed: 0, failedAppointments: [] }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const whatsappUrl = `${supabaseUrl}/functions/v1/whatsapp-service`
  const timezone = business.timezone ?? 'UTC'

  const sendableApts = appointments.filter(
    apt => apt.clients?.phone && !skippedAptIds.has(apt.id)
  )

  const waResults = await Promise.allSettled(
    sendableApts.map(async (apt) => {
      const client = apt.clients!
      const startDate = new Date(apt.start_at)
      const date = startDate.toLocaleDateString('es-CO', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone,
      })
      const time = startDate.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', timeZone: timezone,
      })

      const res = await fetch(whatsappUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': cronSecret,
        },
        body: JSON.stringify({
          to: client.phone,
          clientName: client.name,
          businessName: business.name,
          date,
          time,
        }),
      })

      const data = await res.json().catch(() => ({ success: false })) as { success?: boolean }
      const now = new Date().toISOString()

      const supabase = createAdminClient()
      await supabase.from('appointment_reminders').upsert({
        appointment_id: apt.id,
        business_id: business.id,
        remind_at: now,
        status: data.success === true ? 'sent' : 'failed',
        channel: 'whatsapp',
        sent_at: data.success === true ? now : null,
        error_message: data.success === true ? null : 'WhatsApp delivery failed',
      }, { onConflict: 'appointment_id' })

      return data.success === true
    })
  )

  let sent = 0
  let failed = 0
  const failedAppointments: AppointmentWithClient[] = []

  for (let i = 0; i < waResults.length; i++) {
    const result = waResults[i]!
    if (result.status === 'fulfilled' && result.value) {
      sent++
    } else {
      failed++
      failedAppointments.push(sendableApts[i]!)
    }
  }

  return { sent, failed, failedAppointments }
}
