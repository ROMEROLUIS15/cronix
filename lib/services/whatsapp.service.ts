/**
 * WhatsApp Service — proxy to Supabase Edge Function.
 *
 * The actual Meta API call lives in the Edge Function so that
 * WhatsApp credentials are stored as Supabase Secrets and never
 * exposed to Vercel environment or the client.
 *
 * Required env vars (Next.js server-side):
 *   NEXT_PUBLIC_SUPABASE_URL  — Supabase project URL
 *   CRON_SECRET               — shared secret with the Edge Function
 */

export interface ReminderMessageParams {
  /** Destination phone — any format; non-digit chars are stripped by the Edge Function. */
  to:           string
  clientName:   string
  /** Business name, e.g. "Salón Cronix" */
  businessName: string
  /** Human-readable date, e.g. "viernes, 21 de marzo de 2026" */
  date:         string
  /** Human-readable time, e.g. "10:30 AM" */
  time:         string
}

export interface WhatsAppResult {
  success: boolean
  error?:  string
}

function isWhatsAppResult(value: unknown): value is WhatsAppResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as Record<string, unknown>).success === 'boolean'
  )
}

/**
 * Sends a WhatsApp reminder via the Supabase Edge Function.
 */
export async function sendAppointmentReminder(
  params: ReminderMessageParams
): Promise<WhatsAppResult> {
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const cronSecret   = process.env.CRON_SECRET

  if (!supabaseUrl || !cronSecret) {
    return { success: false, error: 'NEXT_PUBLIC_SUPABASE_URL or CRON_SECRET not configured' }
  }

  const edgeUrl = `${supabaseUrl}/functions/v1/whatsapp-service`

  try {
    const res = await fetch(edgeUrl, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-internal-secret': cronSecret,
      },
      body: JSON.stringify(params),
    })

    const raw: unknown = await res.json().catch(() => ({ success: false, error: 'Invalid response from Edge Function' }))
    return isWhatsAppResult(raw) ? raw : { success: false, error: 'Unexpected response shape from Edge Function' }
  } catch (e) {
    return {
      success: false,
      error:   e instanceof Error ? e.message : 'Unknown error',
    }
  }
}
