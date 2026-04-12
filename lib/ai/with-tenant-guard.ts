/**
 * with-tenant-guard.ts — Tenant isolation helper for AI tools.
 *
 * SECURITY: Verifies that the `business_id` in tool arguments matches
 * the authenticated user's actual business. Prevents cross-tenant data
 * access when an attacker crafts a request with another tenant's UUID.
 *
 * Usage:
 *   const guard = await createTenantGuard()
 *   const parse = BookAppointmentSchema.safeParse(args)
 *   if (!parse.success) return 'Error de parámetros'
 *   await guard.verify(parse.data.business_id)
 */

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface TenantGuard {
  /**
   * Verifies that the provided businessId belongs to the authenticated user.
   * Returns the user's actual business_id on success, or throws on mismatch.
   */
  verify(requestedBusinessId: string): Promise<void>
  /**
   * Returns the authenticated user's business_id directly.
   * Throws if not authenticated.
   */
  getBusinessId(): Promise<string>
}

/**
 * Creates a tenant guard for the current request.
 * Always creates a fresh guard — no module-level caching to prevent cross-tenant leaks.
 * The ToolContext created per-request holds the single guard instance for that request.
 */
export async function createTenantGuard(): Promise<TenantGuard> {
  // Regular client for auth verification (reads from cookie/session)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('No autenticado')
  }

  // Admin client bypasses RLS on users table — same pattern as dashboard layout.
  // Prevents infinite recursion in the users_isolation RLS policy.
  const admin = createAdminClient()
  const { data: dbUser, error } = await admin
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single()

  if (error || !dbUser?.business_id) {
    logger.error('TENANT-GUARD', 'Failed to resolve business_id', { userId: user.id })
    throw new Error('No se pudo verificar el negocio del usuario')
  }

  const userBusinessId = dbUser.business_id

  return {
    verify(requestedBusinessId: string): Promise<void> {
      if (requestedBusinessId !== userBusinessId) {
        logger.warn('TENANT-GUARD', 'Tenant mismatch detected', {
          userId: user.id,
          requestedBusinessId,
          actualBusinessId: userBusinessId,
        })
        throw new Error('No autorizado para este negocio')
      }
      return Promise.resolve()
    },
    getBusinessId(): Promise<string> {
      return Promise.resolve(userBusinessId)
    },
  }
}
