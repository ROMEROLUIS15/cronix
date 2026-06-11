/**
 * sim-whatsapp.ts — Inject a synthetic inbound WhatsApp message.
 *
 * Builds a Meta-shaped webhook payload, signs it with WHATSAPP_APP_SECRET
 * exactly as Meta does (x-hub-signature-256: sha256=<hmac>), and POSTs it to
 * the `whatsapp-webhook` Edge Function. From there the message follows the
 * REAL production path: webhook → QStash → process-whatsapp (guards → semantic
 * router → ReAct loop → tools → notifications). Nothing here is mocked.
 *
 * Routing: the bot resolves the business from a `#slug` in the message text
 * (see process-whatsapp/message-handler.ts §"3-tier tenant routing"). The
 * default text carries #e2e-test so it lands on the `npm run e2e:setup` fixture.
 *
 *   npx tsx scripts/sim-whatsapp.ts "#e2e-test quiero una cita mañana a las 3"
 *   npx tsx scripts/sim-whatsapp.ts "cancela mi cita" --from +584140000001
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL   — project URL (webhook lives at /functions/v1/whatsapp-webhook)
 *   WHATSAPP_APP_SECRET        — Meta app secret used to sign the payload
 * Optional env:
 *   WA_PHONE_NUMBER_ID         — value.metadata.phone_number_id (default: 'sim-phone-id')
 *   SIM_SENDER_PHONE           — default sender if --from is omitted
 *
 * ⚠️ process-whatsapp will try to reply to `from` via the real Meta Send API.
 *    Use a number you control (or expect the outbound send to fail harmlessly —
 *    the pipeline, DB writes and traces still run).
 */

import { createHmac } from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const APP_SECRET   = process.env.WHATSAPP_APP_SECRET
const PHONE_ID     = process.env.WA_PHONE_NUMBER_ID ?? 'sim-phone-id'

if (!SUPABASE_URL || !APP_SECRET) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or WHATSAPP_APP_SECRET in .env.local')
  process.exit(1)
}

// ── CLI parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let from = process.env.SIM_SENDER_PHONE ?? '+584140000001'
const textParts: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  if (a === '--from') { from = argv[++i] ?? from; continue }
  textParts.push(a)
}
const text = textParts.join(' ').trim() || '#e2e-test quiero agendar una cita mañana a las 3'

// ── Synthetic Meta webhook payload ───────────────────────────────────────────
const messageId = `wamid.sim.${Date.now()}`
const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'sim-waba-id',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: PHONE_ID,
              phone_number_id:      PHONE_ID,
            },
            contacts: [{ profile: { name: 'Sim Tester' }, wa_id: from.replace('+', '') }],
            messages: [
              {
                from:      from.replace('+', ''),
                id:        messageId,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type:      'text',
                text:      { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
}

const rawBody   = JSON.stringify(payload)
const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')
const endpoint  = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`

async function main(): Promise<void> {
  console.log(`📤 POST ${endpoint}`)
  console.log(`   from: ${from}`)
  console.log(`   text: "${text}"`)
  console.log(`   msgId: ${messageId}\n`)

  const res  = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-hub-signature-256': signature,
    },
    body: rawBody,
  })
  const body = await res.text()

  console.log(`← ${res.status} ${res.statusText}`)
  console.log(`  ${body}`)

  if (res.ok) {
    console.log('\n✅ Enqueued to QStash. process-whatsapp runs async.')
    console.log('   Observe via PostgreSQL MCP / Supabase logs:')
    console.log('   • interactions / wa_sessions rows for this sender')
    console.log('   • appointments table if a booking tool fired')
    console.log('   • dead_letter_queue if the pipeline crashed (constitution §6)')
  } else {
    console.log('\n⚠️  Non-2xx. 401 = bad HMAC (check WHATSAPP_APP_SECRET); 202 = saved to DLQ.')
  }
}

main().catch((err) => {
  console.error('💥 Error:', err)
  process.exit(1)
})
