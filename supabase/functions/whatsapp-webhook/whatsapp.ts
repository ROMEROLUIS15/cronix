/**
 * WhatsApp Utility for sending free-form text messages.
 */
export async function sendWhatsAppMessage(to: string, text: string, phoneNumberId?: string) {
  const pid         = phoneNumberId || Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')

  if (!pid || !accessToken) {
    throw new Error('WhatsApp credentials not configured')
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${pid}/messages`, {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${accessToken}`,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to:                to,
      type:              'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(`Meta API error: ${JSON.stringify(errorBody)}`)
  }

  return await res.json()
}
