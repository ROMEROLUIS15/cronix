/**
 * Supabase Edge Function — WhatsApp AI Webhook (QStash Receiver)
 *
 * Security layers:
 *  1. Meta HMAC-SHA256 signature verification (prevents spoofed requests)
 *  2. Forwards to QStash to detach receiving from heavy AI processing.
 *     Returns 200 OK immediately.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import type { MetaWebhookPayload } from "./types.ts"
import {
  initSentry,
  captureException,
  addBreadcrumb,
  flushSentry,
} from "../_shared/sentry.ts"

initSentry('whatsapp-webhook')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ── Meta HMAC signature verification ─────────────────────────────────────────

async function verifyMetaSignature(signature: string | null, rawBody: string): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!appSecret) {
    console.error('[verifyMetaSignature] Error: WHATSAPP_APP_SECRET is not set in environment.')
    return false
  }
  if (!signature?.startsWith('sha256=')) {
    console.error('[verifyMetaSignature] Error: Missing or invalid signature header:', signature)
    return false
  }

  const expectedHash = signature.slice(7)
  const encoder      = new TextEncoder()
  const key          = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac          = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const computedHash = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (computedHash !== expectedHash) {
    console.error(`[verifyMetaSignature] Error: Hash mismatch. Validating against signature failed. Check if WHATSAPP_APP_SECRET corresponds to the Meta App sending the webhook.`)
    return false
  }

  return true
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const { method } = req

  if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // ── Webhook verification (GET) ────────────────────────────────────────────
  if (method === 'GET') {
    const url         = new URL(req.url)
    const mode        = url.searchParams.get('hub.mode')
    const token       = url.searchParams.get('hub.verify_token')
    const challenge   = url.searchParams.get('hub.challenge')
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN')

    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Verification failed', { status: 403 })
  }

  // ── Incoming message (POST) ───────────────────────────────────────────────
  if (method === 'POST') {
    const rawBody = await req.text()

    // Layer 1: Meta HMAC verification
    const isValid = await verifyMetaSignature(req.headers.get('x-hub-signature-256'), rawBody)
    
    if (!isValid) {
      await flushSentry()
      return new Response('Unauthorized', { status: 401 })
    }

    addBreadcrumb('Meta HMAC signature verified', 'security')

    try {
      const body: MetaWebhookPayload = JSON.parse(rawBody)
      const value    = body.entry?.[0]?.changes?.[0]?.value
      // Note: We only check if it is a message. Meta also sends 'statuses' (read receipts)
      // which we intentionally ignore to save QStash quota.
      const messages = value?.messages

      if (body.object !== 'whatsapp_business_account' || !messages?.[0]) {
        await flushSentry()
        return json({ success: true, message: 'Event ignored (not a message)' })
      }

      // Forwarding to QStash targeting our separate processor function.
      const supabaseUrl    = Deno.env.get('SUPABASE_URL')
      const qstashToken    = Deno.env.get('QSTASH_TOKEN')
      // Fallback: if PROCESS_WHATSAPP_URL is not set, assume the same project's process-whatsapp function
      const destinationUrl = Deno.env.get('PROCESS_WHATSAPP_URL') || 
                            (supabaseUrl ? `${supabaseUrl}/functions/v1/process-whatsapp` : null)

      if (!destinationUrl || !qstashToken) {
        const missing = [
          !destinationUrl && 'PROCESS_WHATSAPP_URL',
          !qstashToken && 'QSTASH_TOKEN'
        ].filter(Boolean).join(' and ')
        throw new Error(`Missing environment variables: ${missing}. Please set them using 'supabase secrets set'.`)
      }

      // Call Upstash QStash REST API
      const qstashResponse = await fetch(`https://qstash.upstash.io/v2/publish/${destinationUrl}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${qstashToken}`,
          "Content-Type": "application/json",
          // Send along message ID as deduplication ID to ensure we don't enqueue the exact same message twice
          ...(messages[0].id ? { "Upstash-Deduplication-Id": messages[0].id } : {})
        },
        body: rawBody
      });

      if (!qstashResponse.ok) {
        const errorText = await qstashResponse.text()
        throw new Error(`Failed to publish to QStash: ${qstashResponse.status} - ${errorText}`)
      }

      addBreadcrumb('Message enqueued to QStash', 'infrastructure', 'info', { message_id: messages[0].id })
      await flushSentry()

      // ALWAYS return 200 OK immediately so Meta stops retrying.
      return json({ success: true, enqueued: true })

    } catch (error) {
      captureException(error, { stage: 'webhook_post_handler' })
      await flushSentry()
      // Return 200 OK even on error so Meta doesn't retry?
      // Actually, if we fail to enqueue to QStash, we DO want Meta to retry! So we return 500.
      return json({ error: 'Internal Server Error' }, 500)
    }
  }

  await flushSentry()
  return json({ error: 'Method not allowed' }, 405)
})
