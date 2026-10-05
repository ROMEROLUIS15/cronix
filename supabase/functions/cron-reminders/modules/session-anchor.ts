import { createAdminClient } from './db.ts'
import { toWaSenderId } from '../../_shared/wa-phone.ts'
import { addBreadcrumb, captureException } from '../../_shared/sentry.ts'

/**
 * Anchors the reminded client's WhatsApp sender to this business in `wa_sessions`
 * (operacion-canonica R2): the reminder invites the client to reply on the same chat,
 * and that reply carries no #slug — without this row it falls to the generic landing.
 *
 * Last reminder wins when a phone belongs to several businesses (upsert on
 * `sender_phone`). Best-effort: a failure is reported and never breaks the run.
 */
export async function anchorReminderSession(
  clientPhone: string | null,
  businessId: string,
): Promise<void> {
  const senderPhone = toWaSenderId(clientPhone)
  if (!senderPhone) return

  try {
    const { error } = await createAdminClient()
      .from('wa_sessions')
      .upsert(
        { sender_phone: senderPhone, business_id: businessId, updated_at: new Date().toISOString() },
        { onConflict: 'sender_phone' },
      )
    if (error) throw new Error(error.message)
    addBreadcrumb('Reminder session anchored', 'reminders', 'info', { business_id: businessId })
  } catch (err) {
    console.warn('[cron-reminders] wa_sessions anchor failed:', err)
    captureException(err, { stage: 'reminder_session_anchor', business_id: businessId })
  }
}
