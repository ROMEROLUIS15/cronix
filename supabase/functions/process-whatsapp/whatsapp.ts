/**
 * WhatsApp Utilities.
 *  - sendWhatsAppMessage   → send text messages
 *  - downloadMediaBuffer   → download voice note binary from Meta CDN
 */
export async function sendWhatsAppMessage(to: string, text: string) {
  // Always use the env var — never trust Meta's incoming phone_number_id,
  // which could route replies through the test number.
  // @ts-ignore - Deno runtime
  const pid = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  // @ts-ignore
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

/**
 * Downloads a WhatsApp media file (voice note) as an ArrayBuffer.
 *
 * Flow:
 *  1. Resolve the CDN URL from Meta's media API using the media ID
 *  2. Download the binary from the CDN URL
 *
 * The returned buffer is passed directly to Groq Whisper for transcription.
 */
export async function downloadMediaBuffer(mediaId: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  // @ts-ignore — Deno runtime
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not configured')

  // 1. Resolve CDN URL
  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) throw new Error(`Meta media resolve error: ${await metaRes.text()}`)

  const { url, mime_type } = await metaRes.json() as { url: string; mime_type: string }

  // 2. Download binary (with 5MB safety limit)
  const cdnRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  
  if (!cdnRes.ok) throw new Error(`Meta CDN download error: ${await cdnRes.text()}`)

  // Check Content-Length to avoid downloading massive assets
  const contentLength = parseInt(cdnRes.headers.get('content-length') ?? '0', 10)
  const MAX_SIZE      = 5 * 1024 * 1024 // 5MB
  
  if (contentLength > MAX_SIZE) {
    throw new Error(`Media file too large: ${contentLength} bytes (Max: 5MB)`)
  }

  return { buffer: await cdnRes.arrayBuffer(), mimeType: mime_type ?? 'audio/ogg' }
}
