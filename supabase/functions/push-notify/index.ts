/**
 * Supabase Edge Function — push-notify
 *
 * Sends Web Push notifications (RFC 8030 + RFC 8291) to all subscriptions
 * belonging to the requesting user's business (multi-tenant safe).
 *
 * Security — two auth paths:
 *  A) Authorization: Bearer <JWT>  → browser call (new appointment created)
 *     business_id resolved from the authenticated user's record.
 *  B) x-internal-secret: <CRON_SECRET> → server call (cron-reminders EF)
 *     business_id must be provided in the request body.
 *  In both cases, subscriptions are filtered strictly by business_id → zero cross-tenant leakage.
 *
 * Required Supabase Secrets (supabase secrets set NAME=value):
 *   VAPID_PUBLIC_KEY   — base64url-encoded VAPID public key (65 bytes)
 *   VAPID_PRIVATE_KEY  — base64url-encoded VAPID private key (32 bytes)
 *   VAPID_SUBJECT      — mailto: URI or https URL (e.g. mailto:admin@cronix.app)
 *
 * Auto-injected by Supabase runtime:
 *   SUPABASE_URL              — project URL
 *   SUPABASE_ANON_KEY         — anon key (used for user JWT validation)
 *   SUPABASE_SERVICE_ROLE_KEY — service key (used for subscription queries)
 *
 * Deploy:
 *   npx supabase functions deploy push-notify
 *
 * Generate VAPID keys locally:
 *   node -e "const {generateVAPIDKeys}=require('web-push'); console.log(JSON.stringify(generateVAPIDKeys(),null,2))"
 *   OR: npx web-push generate-vapid-keys
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── VAPID helpers (Web Crypto API — no npm deps) ──────────────────────────────

/** base64url → Uint8Array */
function fromB64url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad    = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(pad)
  return Uint8Array.from(binary.split(''), c => c.charCodeAt(0))
}

/** Uint8Array → base64url */
function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** string → base64url */
function strToB64url(str: string): string {
  return toB64url(new TextEncoder().encode(str))
}

/**
 * Wraps a raw 32-byte P-256 private key in a PKCS#8 DER envelope
 * so that crypto.subtle.importKey('pkcs8', ...) can accept it.
 *
 * Structure (RFC 5915 + RFC 5958):
 *   SEQUENCE {
 *     INTEGER 0                              -- version
 *     SEQUENCE { OID ecPublicKey; OID P-256 } -- algorithmIdentifier
 *     OCTET STRING {                         -- privateKey
 *       SEQUENCE {
 *         INTEGER 1; OCTET STRING <32 bytes>  -- ECPrivateKey
 *       }
 *     }
 *   }
 */
function wrapP256KeyInPKCS8(rawKey: Uint8Array): ArrayBuffer {
  // prettier-ignore
  const header = new Uint8Array([
    0x30, 0x41,                    // SEQUENCE (65 bytes)
      0x02, 0x01, 0x00,            // INTEGER 0 (version)
      0x30, 0x13,                  // SEQUENCE (19 bytes) AlgorithmIdentifier
        0x06, 0x07,                //   OID id-ecPublicKey
          0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
        0x06, 0x08,                //   OID secp256r1 (P-256)
          0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,
      0x04, 0x27,                  // OCTET STRING (39 bytes)
        0x30, 0x25,                //   SEQUENCE (37 bytes) ECPrivateKey
          0x02, 0x01, 0x01,        //     INTEGER 1 (ecPrivkeyVer1)
          0x04, 0x20,              //     OCTET STRING (32 bytes) = raw key
  ])
  const pkcs8 = new Uint8Array(header.length + 32)
  pkcs8.set(header)
  pkcs8.set(rawKey.slice(0, 32), header.length)
  return pkcs8.buffer
}

/**
 * Creates a VAPID JWT signed with ES256 (ECDSA P-256 + SHA-256).
 * @param audience   The push service origin (e.g. "https://fcm.googleapis.com")
 * @param subject    VAPID subject ("mailto:..." or "https://...")
 * @param rawPrivKey Raw 32-byte private key (base64url)
 */
async function createVapidJWT(
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

// ── Web Push sender ──────────────────────────────────────────────────────────

interface PushSubscription {
  endpoint: string
  p256dh:   string
  auth:     string
}

interface PushPayload {
  title?: string
  body?:  string
  url?:   string
  icon?:  string
}

/**
 * Encrypts a Web Push message payload using RFC 8291 (aesgcm/aes128gcm).
 * Implements the "aesgcm" content encoding (draft-ietf-webpush-encryption-08).
 */
async function encryptPayload(
  subscription: PushSubscription,
  payloadStr:   string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const encoder       = new TextEncoder()
  const plaintext     = encoder.encode(payloadStr)

  // Generate ephemeral ECDH key pair (server-side, per message)
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )

  // Export server public key (65-byte uncompressed point)
  const serverPubRaw  = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  )

  // Import subscriber's public key
  const clientPubKey  = await crypto.subtle.importKey(
    'raw',
    fromB64url(subscription.p256dh),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // ECDH key agreement → shared secret (32 bytes)
  const sharedBits    = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    serverKeyPair.privateKey,
    256,
  )

  // Random 16-byte salt
  const salt          = crypto.getRandomValues(new Uint8Array(16))
  const authSecret    = fromB64url(subscription.auth)

  // ── HKDF to derive PRK and content-encryption key ────────────────────
  // See RFC 8291 §3.3 and draft-ietf-webpush-encryption §3

  const hkdfKey = (keyMaterial: Uint8Array, infoStr: string, salt2: Uint8Array) =>
    crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveBits'])
      .then(k => crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: salt2, info: encoder.encode(infoStr) },
        k,
        256,
      ))

  // auth secret + shared secret → PRK
  const sharedBytes = new Uint8Array(sharedBits)
  const prk         = new Uint8Array(
    await hkdfKey(sharedBytes, 'Content-Encoding: auth\0', authSecret)
  )

  // PRK + context → content-encryption key (16 bytes) and nonce (12 bytes)
  const context     = new Uint8Array([
    ...encoder.encode('P-256\0'),
    0, 65, ...fromB64url(subscription.p256dh),   // receiver pub key
    0, 65, ...serverPubRaw,                       // sender pub key
  ])

  const cekInfo    = new Uint8Array([...encoder.encode('Content-Encoding: aesgcm\0'), ...context])
  const nonceInfo  = new Uint8Array([...encoder.encode('Content-Encoding: nonce\0'),  ...context])

  const cekBits    = await hkdfKey(prk, '', salt)  // info not a string here—see below
  // Override info correctly:
  const cekKey_    = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits'])
  const cekBits_   = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },
    cekKey_,
    128,
  )
  const nonceBits_ = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
    cekKey_,
    96,
  )
  void cekBits // suppress unused

  const cek   = new Uint8Array(cekBits_)
  const nonce = new Uint8Array(nonceBits_)

  // ── AES-128-GCM encryption ────────────────────────────────────────────
  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  )

  // Padding: 2 bytes (zero = no padding)
  const padded = new Uint8Array(2 + plaintext.length)
  padded.set(plaintext, 2)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  )

  return { ciphertext, salt, serverPublicKey: serverPubRaw }
}

/**
 * Sends a single Web Push notification.
 */
async function sendWebPush(
  subscription: PushSubscription,
  payload:      PushPayload,
  vapidPubKey:  string,
  vapidPrivKey: string,
  vapidSubject: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payloadStr = JSON.stringify(payload)

  try {
    // Parse endpoint origin for VAPID audience
    const endpointUrl = new URL(subscription.endpoint)
    const audience    = endpointUrl.origin

    // Create VAPID JWT
    const vapidJWT = await createVapidJWT(audience, vapidSubject, vapidPrivKey)

    // Encrypt payload
    const { ciphertext, salt, serverPublicKey } = await encryptPayload(subscription, payloadStr)

    // Build Crypto-Key header: dh=<serverPubKey>;p256ecdsa=<vapidPubKey>
    const cryptoKey = `dh=${toB64url(serverPublicKey)};p256ecdsa=${vapidPubKey}`

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/octet-stream',
        'Content-Length':  String(ciphertext.length),
        'Content-Encoding': 'aesgcm',
        'Encryption':      `salt=${toB64url(salt)}`,
        'Crypto-Key':      cryptoKey,
        'Authorization':   `vapid t=${vapidJWT},k=${vapidPubKey}`,
        'TTL':             '86400',
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

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''

  // ── Parse body first (needed for both auth paths) ────────────────────
  let body: PushPayload & { business_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // ── Auth — two paths ─────────────────────────────────────────────────
  //
  // PATH A (server→server): x-internal-secret == CRON_SECRET
  //   Used by cron-reminders to send "upcoming reminder" alerts to the owner.
  //   business_id MUST be provided in the request body.
  //
  // PATH B (browser→EF): Authorization: Bearer <Supabase JWT>
  //   Used by the Next.js frontend when a new appointment is created.
  //   business_id is resolved from the authenticated user's record.

  const cronSecret     = Deno.env.get('CRON_SECRET')
  const internalSecret = req.headers.get('x-internal-secret')
  const isInternalCall = !!cronSecret && internalSecret === cronSecret

  let businessId: string

  if (isInternalCall) {
    // PATH A — internal call from cron-reminders
    if (!body.business_id) {
      return json({ error: 'business_id required for internal calls' }, 400)
    }
    businessId = body.business_id
  } else {
    // PATH B — user JWT from the browser
    const authHeader = req.headers.get('authorization') ?? ''
    const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!jwt) return json({ error: 'Unauthorized' }, 401)

    const anonKey  = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth:   { persistSession: false },
    })

    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: dbUser, error: userErr } = await userClient
      .from('users')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (userErr || !dbUser?.business_id) {
      return json({ error: 'Business not found' }, 400)
    }
    businessId = dbUser.business_id as string
  }

  // Extract notification payload (business_id already consumed above)
  const payload: PushPayload = {
    title: body.title,
    body:  body.body,
    url:   body.url,
    icon:  body.icon,
  }

  // ── VAPID credentials ────────────────────────────────────────────────
  const vapidPubKey  = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@cronix.app'

  if (!vapidPubKey || !vapidPrivKey) {
    return json({ error: 'VAPID keys not configured' }, 500)
  }

  // ── Admin client — queries subscriptions (service role bypasses RLS) ─
  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data: subs, error: subsErr } = await adminClient
    .from('notification_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('business_id', businessId)

  if (subsErr) {
    console.error('[push-notify] subscriptions query error:', subsErr.message)
    return json({ error: subsErr.message }, 500)
  }

  if (!subs || subs.length === 0) {
    return json({ ok: true, sent: 0, total: 0 })
  }

  // ── Fan out — send to all subscriptions for this business ────────────
  const results = await Promise.allSettled(
    (subs as PushSubscription[]).map(sub =>
      sendWebPush(sub, payload, vapidPubKey, vapidPrivKey, vapidSubject)
    )
  )

  let sent   = 0
  let failed = 0
  const expiredEndpoints: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled' && result.value.ok) {
      sent++
    } else {
      failed++
      const sub = (subs as PushSubscription[])[i]!
      // 410/404 means subscription expired — clean it up
      if (
        result.status === 'fulfilled' &&
        (result.value.status === 410 || result.value.status === 404)
      ) {
        expiredEndpoints.push(sub.endpoint)
      }
    }
  }

  // Purge expired subscriptions asynchronously (best-effort)
  if (expiredEndpoints.length > 0) {
    adminClient
      .from('notification_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints)
      .then(() => console.log(`[push-notify] purged ${expiredEndpoints.length} expired subs`))
      .catch(err => console.error('[push-notify] purge error:', err))
  }

  return json({ ok: true, sent, failed, total: subs.length })
})
