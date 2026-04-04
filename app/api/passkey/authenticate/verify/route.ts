import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const admin = createAdminClient()
  const { credential } = await request.json()

  const host = request.headers.get('host') || 'localhost'
  const rpID = host.replace(/:\d+$/, '')
  const protocol = rpID === 'localhost' ? 'http' : 'https'
  const origin = `${protocol}://${host}`

  // 🛰️ Define interfaces for Passkey Auth
  interface UserPasskey {
    id: string;
    user_id: string;
    credential_id: string;
    public_key: string;
    counter: number;
    transports: string[] | null;
  }

  interface PasskeyChallenge {
    id: string;
    challenge: string;
  }

  // Find credential in DB by ID
  const { data: storedCredRaw } = await admin
    .from('user_passkeys')
    .select('id, user_id, credential_id, public_key, counter, transports')
    .eq('credential_id', credential.id)
    .single();
  
  const storedCred = storedCredRaw as unknown as UserPasskey | null;

  if (!storedCred) {
    return NextResponse.json({ error: 'Credencial no encontrada' }, { status: 400 })
  }

  // Extract challenge from the client's response to find the matching challenge row
  let clientChallenge: string
  try {
    const clientData = JSON.parse(
      Buffer.from(credential.response.clientDataJSON, 'base64url').toString()
    )
    clientChallenge = clientData.challenge
  } catch {
    return NextResponse.json({ error: 'clientDataJSON inválido' }, { status: 400 })
  }

  const { data: challengeRowRaw } = await (admin.from('passkey_challenges') as any)
    .select('id, challenge')
    .eq('challenge', clientChallenge)
    .single();
  
  const challengeRow = challengeRowRaw as unknown as PasskeyChallenge | null;

  if (!challengeRow) {
    return NextResponse.json({ error: 'Challenge no encontrado' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: storedCred.credential_id,
        publicKey: Buffer.from(storedCred.public_key, 'base64url'),
        counter: storedCred.counter,
        transports: (storedCred.transports ?? undefined) as AuthenticatorTransport[] | undefined,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Verificación fallida' }, { status: 400 })
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'No verificado' }, { status: 400 })
  }

  // Update counter to prevent replay attacks
  await (admin.from('user_passkeys') as any)
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq('id', storedCred.id)

  // Delete used challenge
  await (admin.from('passkey_challenges') as any).delete().eq('id', challengeRow.id)

  // Get user email to generate a magic-link token (admin API does NOT send email)
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(storedCred.user_id)
  if (userError || !userData?.user?.email) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 500 })
  }

  // Generate a one-time token — admin generateLink never sends an email
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: 'Error al generar token de sesión' }, { status: 500 })
  }

  return NextResponse.json({
    verified: true,
    token_hash: linkData.properties.hashed_token,
  })
}
