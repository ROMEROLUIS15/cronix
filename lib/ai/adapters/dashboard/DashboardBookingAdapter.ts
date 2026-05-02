/**
 * DashboardBookingAdapter.ts — Puente entre RealToolExecutor y BookingEngine.
 *
 * RESPONSABILIDADES DEL ADAPTER (solo esto):
 *   1. Obtener TenantContext del usuario autenticado de la sesión
 *   2. Llamar BookingEngine.dispatch(ctx, toolName, args)
 *   3. Convertir ToolResult → { success, result, data? } que espera ExecutionEngine
 *
 * LO QUE NO HACE:
 *   - Lógica de negocio (eso es BookingEngine)
 *   - Verificación manual de business_id (eso es TenantEnforcer en BookingEngine)
 *   - Fuzzy match directo (eso es ClientResolver/ServiceResolver)
 *
 * Migración desde RealToolExecutor:
 *   - RealToolExecutor.execute() → llama a este adapter
 *   - El adapter es transparente: mismo contrato de entrada/salida
 *   - RealToolExecutor puede coexistir durante la migración
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database }       from '@/types/database.types'
import type { BookingData }    from '@/lib/ai/core/contracts/tool-result'
import { serializeForLlm }     from '@/lib/ai/core/contracts/tool-result'
import { TenantEnforcer }      from '@/lib/ai/core/security/TenantEnforcer'
import { BookingEngine }        from '@/lib/ai/core/booking/BookingEngine'
import { getRepos }             from '@/lib/repositories'

// Tipo que espera ExecutionEngine (IToolExecutor.execute)
type ExecResult = {
  success: boolean
  result:  string
  error?:  string
  data?:   BookingData
}

export class DashboardBookingAdapter {
  private engine: BookingEngine

  constructor(supabase: SupabaseClient<Database>) {
    const repos = getRepos(supabase)
    this.engine = new BookingEngine({
      appointmentQuery:   repos.appointments,
      appointmentCommand: repos.appointments,
      clients:            repos.clients,
      services:           repos.services,
    })
  }

  /**
   * Punto de entrada desde RealToolExecutor / ExecutionEngine.
   *
   * @param toolName    Nombre del tool (e.g. 'confirm_booking')
   * @param rawArgs     Args crudos del LLM (ya parseados como objeto)
   * @param userId      ID del usuario autenticado (viene de la sesión)
   * @param businessId  business_id que el LLM incluyó en los args
   * @param timezone    IANA timezone del negocio
   * @param workingHours Horario del negocio (opcional, para get_available_slots)
   */
  async execute(params: {
    toolName:     string
    rawArgs:      unknown
    userId:       string
    businessId:   string
    timezone:     string
    workingHours?: Record<string, { open: string; close: string } | null>
  }): Promise<ExecResult> {
    const { toolName, rawArgs, userId, businessId, timezone, workingHours } = params

    // ── Verificación de tenant (estructural — no manual) ──────────────────────
    let ctx
    try {
      ctx = await TenantEnforcer.verify(businessId, userId, timezone)
    } catch (err) {
      return {
        success: false,
        result:  'No autorizado.',
        error:   err instanceof Error ? err.message : 'UNAUTHORIZED',
      }
    }

    // ── Despachar al BookingEngine ─────────────────────────────────────────────
    const toolResult = await this.engine.dispatch(ctx, toolName, rawArgs, { workingHours })

    if (!toolResult.success) {
      return {
        success: false,
        result:  toolResult.message,
        error:   toolResult.error,
      }
    }

    return {
      success: true,
      result:  toolResult.message,
      // Solo las herramientas de escritura tienen data (BookingData)
      data:    isBookingData(toolResult.data) ? toolResult.data : undefined,
    }
  }
}

function isBookingData(v: unknown): v is BookingData {
  return (
    typeof v === 'object' &&
    v !== null &&
    'appointmentId' in v &&
    'action' in v
  )
}
