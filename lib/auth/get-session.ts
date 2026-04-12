import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface SessionUser {
  id: string
  email?: string | null
  dbUser: {
    id: string
    email: string | null
    name: string | null
    role: string | null
    status: string | null
    business_id: string | null
    avatar_url: string | null
    phone: string | null
    color: string | null
    provider: string | null
    is_active: boolean | null
    created_at: string | null
    updated_at: string | null
  } | null
  business_id: string | null
  [key: string]: unknown
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const supabase = await createClient()

    // 1. CAMBIO DE SEGURIDAD: Usamos getUser() en lugar de getSession()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return null // Si no hay usuario real autenticado, devuelve null
    }

    // 2. Buscamos los datos del usuario logueado en nuestra tabla 'users'
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('id, email, name, role, status, business_id, avatar_url, phone, color, provider, is_active, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle()

    if (dbError) {
      logger.error('getSession', 'Error fetching dbUser', dbError.message)
      // SECURITY: On DB error (e.g., RLS recursion), return null instead of
      // partial state. Downstream code may assume business_id exists and crash.
      return null
    }

    if (!dbUser) {
      // User exists in auth but not in our DB table — incomplete registration
      return null
    }

    return {
      ...user,
      dbUser,
      business_id: dbUser.business_id
    }
  } catch (e) {
    logger.error('getSession', 'Critical failure', e)
    return null
  }
}
