import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { credential, deviceName } = await request.json()

  const host = request.headers.get('host') || 'localhost'
  const rpID = host.replace(/:\d+$/, '')
  const protocol = rpID === 'localhost' ? 'http' : 'https'
  const origin = `${protocol}://${host}`

  // Get stored challenge
  const { data: challengeRow } = await admin
    .from('passkey_challenges')
    .select('challenge')
    .eq('user_id', user.id)
    .single()

  if (!challengeRow) {
    return NextResponse.json({ error: 'Challenge no encontrado' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })
  } catch {
    return NextResponse.json({ error: 'Verificación fallida' }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'No verificado' }, { status: 400 })
  }

  const { id: credentialID, publicKey, counter } = verification.registrationInfo.credential

  await admin.from('user_passkeys').insert({
    user_id: user.id,
    credential_id: credentialID,
    public_key: Buffer.from(publicKey).toString('base64url'),
    counter,
    device_name: deviceName || 'Mi dispositivo',
    transports: credential.response?.transports ?? [],
  })

  // Clean up challenge
  await admin.from('passkey_challenges').delete().eq('user_id', user.id)

  return NextResponse.json({ verified: true })
}
