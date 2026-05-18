/**
 * Short SHA-256 hash for correlation IDs. PII-safe: full text is never stored,
 * only the first 16 hex chars (64 bits — collision-resistant enough for tracing).
 *
 * Works on both Node 18+ and Deno via the WebCrypto API.
 */
export async function shortHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf  = await crypto.subtle.digest('SHA-256', data)
  const arr  = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += arr[i]!.toString(16).padStart(2, '0')
  }
  return out
}
