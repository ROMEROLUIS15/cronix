/**
 * WhatsApp delivery tracking: what Meta says happened to each message after it accepted it.
 *
 * Meta accepting a send (HTTP 200 with a message id) does not mean the message reached the
 * phone; delivery, reading and asynchronous failures (with an error code) only arrive later,
 * as status events on the webhook. This module reads both shapes and writes them to
 * `wa_message_status`, so a message that never arrives is visible for every business.
 */

export type WaDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'
export type WaMessagePurpose = 'client_reminder' | 'owner_alert' | 'owner_summary'

/** Who a sent message belongs to, passed to whatsapp-service by the caller. */
export interface WaMessageTrack {
  businessId:     string
  purpose:        WaMessagePurpose
  appointmentId?: string | null
}

export interface WaStatusUpdate {
  wamid:      string
  status:     WaDeliveryStatus
  at:         string
  errorCode:  number | null
  errorTitle: string | null
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read', 'failed'])
const PURPOSES: ReadonlySet<string> = new Set(['client_reminder', 'owner_alert', 'owner_summary'])

type Json = Record<string, unknown>
const asRecord = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : null)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Every status event in a webhook payload, across all entries and changes. Unknown shapes are skipped. */
export function parseStatusEvents(payload: unknown): WaStatusUpdate[] {
  const updates: WaStatusUpdate[] = []
  for (const entry of asArray(asRecord(payload)?.entry)) {
    for (const change of asArray(asRecord(entry)?.changes)) {
      for (const raw of asArray(asRecord(asRecord(change)?.value)?.statuses)) {
        const s = asRecord(raw)
        const wamid = typeof s?.id === 'string' ? s.id : ''
        const status = typeof s?.status === 'string' ? s.status : ''
        if (!wamid || !KNOWN_STATUSES.has(status)) continue
        const seconds = Number(s?.timestamp)
        const when = new Date(seconds * 1000)
        const error = asRecord(asArray(s?.errors)[0])
        const code = Number(error?.code)
        updates.push({
          wamid,
          status: status as WaDeliveryStatus,
          at: seconds > 0 && !Number.isNaN(when.getTime()) ? when.toISOString() : new Date().toISOString(),
          errorCode: Number.isFinite(code) && error ? code : null,
          errorTitle: error ? String(error.title ?? error.message ?? '').slice(0, 300) || null : null,
        })
      }
    }
  }
  return updates
}

/** The message id Meta returns when it accepts a send, or null. */
export function acceptedMessageId(metaResponse: unknown): string | null {
  const id = asRecord(asArray(asRecord(metaResponse)?.messages)[0])?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** The error code and text Meta returns when it rejects a send. */
export function metaSendError(metaResponse: unknown): { code: number | null; message: string | null } {
  const error = asRecord(asRecord(metaResponse)?.error)
  const code = Number(error?.code)
  const message = typeof error?.message === 'string' ? error.message : null
  return { code: error && Number.isFinite(code) ? code : null, message }
}

/** A track object from a request body, or null when it is missing or malformed. */
export function parseTrack(value: unknown): WaMessageTrack | null {
  const t = asRecord(value)
  if (!t || typeof t.businessId !== 'string' || !t.businessId || typeof t.purpose !== 'string' || !PURPOSES.has(t.purpose)) return null
  const appointmentId = typeof t.appointmentId === 'string' && t.appointmentId ? t.appointmentId : null
  return { businessId: t.businessId, purpose: t.purpose as WaMessagePurpose, appointmentId }
}

interface DeliveryDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
  from(table: string): {
    upsert(values: Record<string, unknown>, options: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>
  }
}

/** Stores Meta's status events. Returns how many failed to be written. */
export async function recordStatuses(db: DeliveryDb, updates: WaStatusUpdate[]): Promise<{ failed: number; lastError: string | null }> {
  let failed = 0
  let lastError: string | null = null
  for (const u of updates) {
    const { error } = await db.rpc('fn_record_wa_status', {
      p_wamid: u.wamid, p_status: u.status, p_error_code: u.errorCode, p_error_title: u.errorTitle, p_at: u.at,
    })
    if (error) { failed++; lastError = error.message }
  }
  return { failed, lastError }
}

/**
 * Stores who an accepted message belongs to. The status is left out of the row on purpose:
 * a status event may have arrived first, and it must not be reset to 'accepted'.
 */
export async function recordAcceptedMessage(
  db: DeliveryDb,
  message: { wamid: string; track: WaMessageTrack; template: string | null; at: string },
): Promise<{ error: string | null }> {
  const { error } = await db.from('wa_message_status').upsert({
    wamid: message.wamid,
    business_id: message.track.businessId,
    purpose: message.track.purpose,
    appointment_id: message.track.appointmentId ?? null,
    template: message.template,
    accepted_at: message.at,
  }, { onConflict: 'wamid' })
  return { error: error ? error.message : null }
}
