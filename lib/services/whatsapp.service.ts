/**
 * WhatsApp Cloud API service.
 *
 * Sends appointment reminder messages using the Meta WhatsApp Business API
 * and the approved `appointment_reminder` template.
 *
 * Required env vars:
 *   WHATSAPP_PHONE_NUMBER_ID  — from Meta Business Manager
 *   WHATSAPP_ACCESS_TOKEN     — permanent or temporary token
 */

const WA_API_BASE = 'https://graph.facebook.com/v19.0'

export interface ReminderMessageParams {
  /** Destination phone — any format; non-digit chars are stripped automatically. */
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

/**
 * Sends a WhatsApp reminder using the `appointment_reminder` template.
 * Template body variables (in order): {{1}} clientName, {{2}} businessName, {{3}} date, {{4}} time.
 */
export async function sendAppointmentReminder(
  params: ReminderMessageParams
): Promise<WhatsAppResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  // Normalise phone: strip spaces, dashes, parentheses, leading +
  const to = params.to.replace(/[\s\-\+\(\)]/g, '')

  try {
    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:     'appointment_reminder',
          language: { code: 'es' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: params.clientName   },
                { type: 'text', text: params.businessName },
                { type: 'text', text: params.date         },
                { type: 'text', text: params.time         },
              ],
            },
          ],
        },
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const msg  = (body as { error?: { message?: string } })?.error?.message
      return { success: false, error: msg ?? `HTTP ${res.status}` }
    }

    return { success: true }
  } catch (e) {
    return {
      success: false,
      error:   e instanceof Error ? e.message : 'Unknown error',
    }
  }
}
