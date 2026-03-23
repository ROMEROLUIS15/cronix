import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function getRpInfo(request: NextRequest) {
  const host = request.headers.get('host') || 'localhost'
  const rpID = host.replace(/:\d+$/, '')
  return { rpID }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { rpID } = getRpInfo(request)

  // Get existing passkeys to exclude them
  const { data: existing } = await admin
    .from('user_passkeys')
    .select('credential_id, transports')
    .eq('user_id', user.id)

  const options = await generateRegistrationOptions({
    rpName: 'Cronix',
    rpID,
    userName: user.email,
    userID: Buffer.from(user.id),
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map(c => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  })

  // Replace any existing challenge for this user
  await admin.from('passkey_challenges').delete().eq('user_id', user.id)
  await admin.from('passkey_challenges').insert({
    challenge: options.challenge,
    user_id: user.id,
  })

  return NextResponse.json(options)
}
