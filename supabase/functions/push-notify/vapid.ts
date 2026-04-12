/**
 * VAPID / Web Push crypto — RFC 8030, RFC 8291, RFC 8292.
 * No external dependencies — uses only Web Crypto API (available in Deno).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PushSubscription {
  endpoint: string
  p256dh:   string
  auth:     string
}

export interface PushPayload {
  title?: string
  body?:  string
  url?:   string
  icon?:  string
}

// ── Base64url helpers ─────────────────────────────────────────────────────────

export function fromB64url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad    = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(pad)
  return Uint8Array.from(binary.split(''), c => c.charCodeAt(0))
}

export function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function strToB64url(str: string): string {
  return toB64url(new TextEncoder().encode(str))
}

// ── PKCS#8 key wrapping ───────────────────────────────────────────────────────

/**
 * Wraps a raw 32-byte P-256 private key in a PKCS#8 DER envelope
 * so that crypto.subtle.importKey('pkcs8', ...) can accept it.
 */
function wrapP256KeyInPKCS8(rawKey: Uint8Array): ArrayBuffer {
  // prettier-ignore
  const header = new Uint8Array([
    0x30, 0x41,
      0x02, 0x01, 0x00,
      0x30, 0x13,
        0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
        0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,
      0x04, 0x27,
        0x30, 0x25,
          0x02, 0x01, 0x01,
          0x04, 0x20,
  ])
  const pkcs8 = new Uint8Array(header.length + 32)
  pkcs8.set(header)
  pkcs8.set(rawKey.slice(0, 32), header.length)
  return pkcs8.buffer
}

// ── VAPID JWT ─────────────────────────────────────────────────────────────────

export async function createVapidJWT(
  audience:   string,
  subject:    string,
  rawPrivKey: string,
): Promise<string> {
  const header  = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const exp     = Math.floor(Date.now() / 1000) + 43_200 // 12 hours
  const payload = strToB64url(JSON.stringify({ aud: audience, exp, sub: subject }))
  const unsigned = `${header}.${payload}`

  const privKeyBytes = fromB64url(rawPrivKey)
  const pkcs8        = wrapP256KeyInPKCS8(privKeyBytes)

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(unsigned),
  )

  return `${unsigned}.${toB64url(new Uint8Array(sigBuffer))}`
}

// ── Payload encryption (RFC 8291 aesgcm) ─────────────────────────────────────

export async function encryptPayload(
  subscription: PushSubscription,
  payloadStr:   string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const encoder   = new TextEncoder()
  const plaintext = encoder.encode(payloadStr)

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )

  const serverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  )

  const clientPubKey = await crypto.subtle.importKey(
    'raw',
    fromB64url(subscription.p256dh),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    serverKeyPair.privateKey,
    256,
  )

  const salt       = crypto.getRandomValues(new Uint8Array(16))
  const authSecret = fromB64url(subscription.auth)

  const hkdfKey = (keyMaterial: Uint8Array, infoStr: string, salt2: Uint8Array) =>
    crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveBits'])
      .then(k => crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: salt2, info: encoder.encode(infoStr) },
        k,
        256,
      ))

  const sharedBytes = new Uint8Array(sharedBits)
  const prk         = new Uint8Array(await hkdfKey(sharedBytes, 'Content-Encoding: auth\0', authSecret))

  const context  = new Uint8Array([
    ...encoder.encode('P-256\0'),
    0, 65, ...fromB64url(subscription.p256dh),
    0, 65, ...serverPubRaw,
  ])

  const cekInfo   = new Uint8Array([...encoder.encode('Content-Encoding: aesgcm\0'), ...context])
  const nonceInfo = new Uint8Array([...encoder.encode('Content-Encoding: nonce\0'),  ...context])

  const cekKey_    = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits'])
  const cekBits_   = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },   cekKey_, 128,
  )
  const nonceBits_ = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, cekKey_, 96,
  )

  const cek   = new Uint8Array(cekBits_)
  const nonce = new Uint8Array(nonceBits_)

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])

  const padded = new Uint8Array(2 + plaintext.length)
  padded.set(plaintext, 2)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  )

  return { ciphertext, salt, serverPublicKey: serverPubRaw }
}

// ── Single push sender ────────────────────────────────────────────────────────

export async function sendWebPush(
  subscription: PushSubscription,
  payload:      PushPayload,
  vapidPubKey:  string,
  vapidPrivKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const endpointUrl = new URL(subscription.endpoint)
    const vapidJWT    = await createVapidJWT(endpointUrl.origin, vapidSubject, vapidPrivKey)
    const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, JSON.stringify(payload))

    const cryptoKey = `dh=${toB64url(serverPublicKey)};p256ecdsa=${vapidPubKey}`

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Length':   String(ciphertext.length),
        'Content-Encoding': 'aesgcm',
        'Encryption':       `salt=${toB64url(salt)}`,
        'Crypto-Key':       cryptoKey,
        'Authorization':    `vapid t=${vapidJWT},k=${vapidPubKey}`,
        'TTL':              '86400',
      },
      body: ciphertext,
    })

    if (res.status === 410 || res.status === 404) {
      return { ok: false, status: res.status, error: 'Subscription expired' }
    }

    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
