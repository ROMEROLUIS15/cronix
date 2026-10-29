/**
 * hmac.ts — HMAC-SHA256 signatures for webhooks and service-to-service calls.
 *
 * Shared by whatsapp-webhook (Meta's signature) and phone-agent-api (the voice call
 * agent's signature). The comparison takes the same time whatever the input, so a
 * caller cannot learn a valid signature byte by byte from response times.
 */

const encoder = new TextEncoder()

/** Lowercase hex HMAC-SHA256 of `message` with `secret`. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Equal strings, compared in time that depends only on their lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}
