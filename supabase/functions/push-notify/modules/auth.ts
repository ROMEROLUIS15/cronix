import { createUserClient } from './modules/subscription-manager.ts'

export async function resolveBusinessIdFromJwt(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | null
): Promise<string | null> {
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return null

  const userClient = createUserClient(supabaseUrl, anonKey, jwt)
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return null

  const { data: dbUser, error: userErr } = await userClient
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single()

  if (userErr || !dbUser?.business_id) return null
  return dbUser.business_id as string
}
