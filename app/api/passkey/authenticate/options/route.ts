import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const admin = createAdminClient()

  const host = request.headers.get('host') || 'localhost'
  const rpID = host.replace(/:\d+$/, '')

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  })

  // Store challenge without user_id (login flow — user unknown yet)
  await (admin as any).from('passkey_challenges').insert({ challenge: options.challenge })

  return NextResponse.json(options)
}
