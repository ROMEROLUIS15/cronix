/**
 * trigger-voice.ts — Drive the Voice Agent with one synthetic turn.
 *
 * The voice-worker Edge Function is JWT-gated (verify_jwt=true). This script
 * mints a REAL user session by signing in the E2E fixture user (created by
 * `npm run e2e:setup`), then POSTs the text path ({ text, timezone, history })
 * to voice-worker — exercising the live agent loop: auth → rate-limit →
 * business-context load → runAgent → tool execution → bell notifications.
 *
 * The text path is the desktop/Web-Speech path (index.ts §"Text path"), so no
 * audio/STT is needed — pass the utterance directly.
 *
 *   npx tsx scripts/trigger-voice.ts "qué citas tengo mañana"
 *   npx tsx scripts/trigger-voice.ts "recuérdame mi próxima cita" --tz America/Caracas
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   — to sign the fixture user in
 * Optional env (defaults match scripts/setup-e2e-data.ts):
 *   E2E_TEST_EMAIL    (default test-e2e@cronix.com)
 *   E2E_TEST_PASSWORD (default test-password-e2e-123!)
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL        = process.env.E2E_TEST_EMAIL    ?? 'test-e2e@cronix.com'
const PASSWORD     = process.env.E2E_TEST_PASSWORD ?? 'test-password-e2e-123!'

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

// ── CLI parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let timezone = 'America/Caracas'
const textParts: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  if (a === '--tz') { timezone = argv[++i] ?? timezone; continue }
  textParts.push(a)
}
const text = textParts.join(' ').trim() || 'qué citas tengo mañana'

async function main(): Promise<void> {
  // 1. Mint a real user JWT via the fixture login (no admin key needed).
  const auth = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await auth.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !data.session) {
    console.error(`❌ Could not sign in fixture user (${EMAIL}): ${error?.message ?? 'no session'}`)
    console.error('   Run `npm run e2e:setup` first to create it.')
    process.exit(1)
  }
  const jwt = data.session.access_token

  // 2. Fire the voice-worker text path.
  const endpoint = `${SUPABASE_URL}/functions/v1/voice-worker`
  console.log(`📤 POST ${endpoint}`)
  console.log(`   user: ${EMAIL}  tz: ${timezone}`)
  console.log(`   text: "${text}"\n`)

  const start = Date.now()
  const res   = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify({ text, timezone, history: [] }),
  })
  const ms   = Date.now() - start
  const body = await res.text()

  console.log(`← ${res.status} ${res.statusText}  (${ms} ms)`)
  try {
    const json = JSON.parse(body)
    console.log(`  reply        : ${json.text ?? '∅'}`)
    console.log(`  actionPerformed: ${json.actionPerformed ?? '∅'}`)
    console.log(`  modelUsed    : ${json.modelUsed ?? '∅'}`)
  } catch {
    console.log(`  ${body}`)
  }

  if (res.ok) {
    console.log('\n✅ Trace emitted to channel=voice-worker (see /dashboard/observability or LangSmith).')
  } else {
    console.log('\n⚠️  401 = JWT/profile issue; 429 = rate-limited; 422 = STT noise guard; 500 = agent failure.')
  }
}

main().catch((err) => {
  console.error('💥 Error:', err)
  process.exit(1)
})
