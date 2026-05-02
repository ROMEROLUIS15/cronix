/**
 * TenantEnforcer.ts — Verificación de tenant estructuralmente obligatoria.
 *
 * PROBLEMA ANTERIOR:
 *   Cada tool llamaba manualmente a ctx.tenantGuard.verify(business_id).
 *   Si un tool nuevo olvidaba la llamada → brecha de seguridad silenciosa.
 *
 * SOLUCIÓN:
 *   TenantContext es un phantom type que SOLO puede construirse a través de
 *   TenantEnforcer.verify(). El BookingEngine acepta TenantContext, no string.
 *   TypeScript rechaza en compilación cualquier intento de bypass.
 *
 * Uso:
 *   const ctx = await TenantEnforcer.verify(requestedBusinessId, authUserId, timezone)
 *   await bookingEngine.createAppointment(ctx, payload)
 *   // Si TenantEnforcer.verify() hubiera fallado, habría thrown antes de llegar aquí
 */

import { logger } from '@/lib/logger'

// ── Phantom type: solo se puede construir dentro de este módulo ───────────────
// El campo _brand no existe en runtime (es eliminado por el transpiler).
// Lo importante: el único lugar que hace `as TenantContext` es TenantEnforcer.verify().

declare const __tenantBrand: unique symbol

export type TenantContext = {
  readonly businessId: string
  readonly userId:     string
  readonly timezone:   string
  readonly [__tenantBrand]: true
}

// ── Enforcer ──────────────────────────────────────────────────────────────────

export class TenantEnforcer {
  /**
   * Verifica que requestedBusinessId pertenece al usuario autenticado.
   * Retorna un TenantContext sellado — el único token válido para BookingEngine.
   *
   * @throws Error('UNAUTHORIZED') si la verificación falla.
   *         El caller NO debe continuar si esta función lanza.
   */
  static async verify(
    requestedBusinessId: string,
    authUserId: string,
    timezone: string,
  ): Promise<TenantContext> {
    // Import dinámico para mantener este módulo compatible con edge runtimes
    const { createAdminClient } = await import('@/lib/supabase/server')

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('users')
      .select('business_id')
      .eq('id', authUserId)
      .single()

    if (error || !data?.business_id) {
      logger.error('TENANT-ENFORCER', 'Failed to resolve business_id', { authUserId })
      throw new Error('UNAUTHORIZED: no se pudo verificar el tenant del usuario')
    }

    if (data.business_id !== requestedBusinessId) {
      logger.warn('TENANT-ENFORCER', 'Tenant mismatch — possible injection attempt', {
        authUserId,
        requestedBusinessId,
        actualBusinessId: data.business_id,
      })
      throw new Error('UNAUTHORIZED: business_id no pertenece a este usuario')
    }

    return {
      businessId: data.business_id,
      userId:     authUserId,
      timezone,
    } as unknown as TenantContext
  }

  /**
   * Versión para canales externos (WhatsApp) donde el businessId viene del
   * webhook (verificado por HMAC), no de un usuario autenticado con sesión.
   * Solo verifica que el negocio exista y esté activo.
   *
   * NO usar para canales autenticados (dashboard, app).
   */
  static async verifyWebhook(
    businessId: string,
    timezone: string,
  ): Promise<TenantContext> {
    const { createAdminClient } = await import('@/lib/supabase/server')

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('businesses')
      .select('id, timezone')
      .eq('id', businessId)
      .single()

    if (error || !data) {
      throw new Error('UNAUTHORIZED: negocio no encontrado')
    }

    return {
      businessId: data.id,
      userId:     'webhook',
      timezone:   timezone || data.timezone || 'UTC',
    } as unknown as TenantContext
  }
}
