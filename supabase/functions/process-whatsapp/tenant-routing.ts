/**
 * tenant-routing.ts — 4-tier tenant resolution for an incoming WhatsApp message
 * (modulo-whatsapp-citas manifest §1). Extracted from message-handler.ts so the
 * handler orchestrates and this unit owns the routing decision.
 *
 *  1. #slug in the message      → resolve by slug, anchor the session
 *  2. wa_sessions               → last business the sender talked to (or was reminded by)
 *  3. client phone              → the business that has this sender as a client, anchor it
 *  4. none                      → generic landing + a pushed signal (replyUnrouted)
 */

import type { BusinessRow } from "./types.ts"
import { sendWhatsAppMessage } from "./whatsapp.ts"
import { addBreadcrumb, captureMessage } from "../_shared/sentry.ts"
import {
  getBusinessBySlug, getSessionBusiness, getBusinessByClientPhone, upsertSession,
} from "./business-router.ts"

const LANDING_TEXT =
  '¡Hola! 👋 Soy el asistente virtual de reservas de *Cronix*.\n\n' +
  'Para comunicarte con un negocio y agendar una cita, necesitas usar su enlace directo de WhatsApp.\n\n' +
  '🔗 Encuentra todos los negocios disponibles en:\nhttps://cronix-app.vercel.app\n\n' +
  '¡Te esperamos!'

/** Resolves the tenant for this sender, or null when no tier applies (→ replyUnrouted). */
export async function resolveTenant(sender: string, slug: string | null): Promise<BusinessRow | null> {
  const bySlug = slug ? await getBusinessBySlug(slug) : null
  if (bySlug) {
    await upsertSession(sender, bySlug.id)
    addBreadcrumb('Business resolved by slug', 'tenant', 'info', { slug })
    return bySlug
  }

  const bySession = await getSessionBusiness(sender)
  if (bySession) {
    addBreadcrumb('Business resolved by session', 'tenant', 'info')
    return bySession
  }

  const byClient = await getBusinessByClientPhone(sender)
  if (byClient) {
    await upsertSession(sender, byClient.id)
    addBreadcrumb('Business resolved by client phone', 'tenant', 'info', { business_id: byClient.id })
    return byClient
  }
  return null
}

export interface UnroutedInfo {
  messageType: string
  textLength:  number
  hadSlug:     boolean
}

/**
 * Tier 4: the sender gets the landing, and the miss is pushed to Sentry. It used to
 * return 200 with no trace at all — that is how replies to reminders vanished for weeks
 * (2026-07-29 → 2026-10-05). No message content is sent, only its shape.
 */
export async function replyUnrouted(sender: string, info: UnroutedInfo): Promise<void> {
  captureMessage('WhatsApp message could not be routed to a business', 'warning', {
    stage:        'wa_unrouted_message',
    message_type: info.messageType,
    text_length:  info.textLength,
    had_slug:     info.hadSlug,
  })
  await sendWhatsAppMessage(sender, LANDING_TEXT)
}
