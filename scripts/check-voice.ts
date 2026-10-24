/**
 * check-voice.ts — Synthetic check of the deployed voice-worker audio path.
 *
 * Signs in the E2E fixture user and uploads a real WebM/Opus recording
 * (tests/e2e/fixtures/voice/que-citas-tengo-hoy.webm, the same container the
 * dashboard FAB sends) to the deployed voice-worker. It passes only when the
 * worker answers 200 with a transcription of that question and a non-empty
 * reply; otherwise it exits 1, so the scheduled CI run turns red and notifies.
 *
 * Catches what the browser E2E cannot see between pushes: an expired Deepgram
 * or Groq key, a broken edge deploy, a changed response shape.
 *
 *   npm run check:voice
 *
 * Required env (.env.local or CI secrets):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   E2E_TEST_EMAIL, E2E_TEST_PASSWORD
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { transcribedQuestion } from '../tests/e2e/fixtures/voice/question'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL        = process.env.E2E_TEST_EMAIL
const PASSWORD     = process.env.E2E_TEST_PASSWORD
const FIXTURE      = 'tests/e2e/fixtures/voice/que-citas-tengo-hoy.webm'

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, E2E_TEST_EMAIL or E2E_TEST_PASSWORD')
  process.exit(1)
}

interface VoiceReply { text?: string; transcription?: string; error?: string }

async function postAudio(jwt: string): Promise<{ status: number; body: VoiceReply; ms: number }> {
  const form = new FormData()
  form.append('audio', new Blob([readFileSync(FIXTURE)], { type: 'audio/webm;codecs=opus' }), 'audio.webm')
  form.append('timezone', 'America/Caracas')
  form.append('history', '[]')

  const start = Date.now()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/voice-worker`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body:    form,
    signal:  AbortSignal.timeout(60_000),
  })
  const body = await res.json().catch(() => ({})) as VoiceReply
  return { status: res.status, body, ms: Date.now() - start }
}

async function main(): Promise<void> {
  const auth = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await auth.auth.signInWithPassword({ email: EMAIL!, password: PASSWORD! })
  if (error || !data.session) {
    console.error(`❌ Could not sign in the E2E fixture user: ${error?.message ?? 'no session'}`)
    process.exit(1)
  }

  // One retry on 5xx: a cold start or a provider blip should not page anyone.
  let result = await postAudio(data.session.access_token)
  if (result.status >= 500) {
    console.log(`⚠️  voice-worker answered ${result.status}, retrying once in 5 s…`)
    await new Promise(r => setTimeout(r, 5_000))
    result = await postAudio(data.session.access_token)
  }

  const { status, body, ms } = result
  console.log(`← ${status} in ${ms} ms`)
  console.log(`  transcription: ${body.transcription ?? '∅'}`)
  console.log(`  reply        : ${body.text ?? body.error ?? '∅'}`)

  const failures = [
    status !== 200                           && `HTTP ${status}${body.error ? ` (${body.error})` : ''}`,
    !transcribedQuestion(body.transcription) && 'transcription does not match the recorded question',
    !body.text?.trim()                       && 'empty reply',
  ].filter(Boolean)

  if (failures.length > 0) {
    console.error(`\n❌ Voice check failed: ${failures.join('; ')}`)
    process.exit(1)
  }
  console.log('\n✅ Voice check passed.')
}

main().catch((err) => {
  console.error('💥 Error:', err)
  process.exit(1)
})
