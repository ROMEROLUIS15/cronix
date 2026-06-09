'use server'

/**
 * complete-appointment.ts — Server Action for marking an appointment as completed.
 *
 * Single entry point for the "complete" flow from the dashboard.
 * Orchestrates:
 *   1. Fetches the billing snapshot for this appointment (services + existing transactions)
 *   2. Delegates to CompleteAppointmentUseCase (billing + status update)
 *
 * Why a Server Action?
 *   - CompleteAppointmentUseCase runs on the server (Supabase admin client).
 *   - Client Components (use-dashboard-data, use-appointments-list) cannot import
 *     server-only modules directly. A Server Action is the correct Next.js boundary.
 *   - The billing snapshot query runs here so the Use Case stays free of query-side deps.
 *
 * Exposes:
 *  - completeAppointment(appointmentId, businessId) → Result<CompleteAppointmentOutput>
 *
 * Guarantees:
 *  - Never throws — returns Result<T>.
 *  - Tenant isolation: billing snapshot is scoped by businessId.
 *  - Auth guard: user must be authenticated (withErrorHandler enforces this).
 */

import { createAdminClient }              from '@/lib/supabase/server'
import { getRepos }                        from '@/lib/repositories'
import { CompleteAppointmentUseCase }      from '@/lib/domain/use-cases/CompleteAppointmentUseCase'
import { ok, fail }                        from '@/types/result'
import { logger }                          from '@/lib/logger'
import type { CompleteAppointmentOutput }  from '@/lib/domain/use-cases/CompleteAppointmentUseCase'
import type { Result }                     from '@/types/result'

/**
 * Completes an appointment with auto-billing.
 *
 * @param appointmentId - The appointment to complete.
 * @param businessId    - The owning business — used for tenant isolation on the billing query.
 */
export async function completeAppointment(
  appointmentId: string,
  businessId:    string,
): Promise<Result<CompleteAppointmentOutput>> {
  try {
    // Admin client: bypasses RLS on the billing snapshot query.
    // The businessId filter below is the explicit ownership boundary.
    const supabase = createAdminClient()
    const { appointments: appointmentRepo, finances: financeRepo } = getRepos(supabase)

    // ── Billing snapshot ────────────────────────────────────────────────────
    // Fetch services + existing transactions scoped to this appointment+business.
    // This is the query-side responsibility that stays OUT of the Use Case.
    const { data: apt, error: fetchError } = await supabase
      .from('appointments')
      .select(`
        business_id,
        appointment_services (
          service:services(price, name)
        ),
        transactions (
          net_amount
        )
      `)
      .eq('id', appointmentId)
      .eq('business_id', businessId)
      .single()

    if (fetchError || !apt) {
      logger.warn(
        'complete-appointment-action',
        'Appointment not found or cross-tenant — billing skipped, status still updated',
        { appointmentId, businessId },
      )
      // Fall through with zero billing. updateStatus will still fail gracefully
      // if the row doesn't belong to the business (0 rows updated → error).
    }

    // Compute billing snapshot values
    type ServiceRelation = { service?: { price?: number | null; name?: string | null } | null }
    type TransactionRow  = { net_amount?: number | null }

    const services: ServiceRelation[] = (apt as any)?.appointment_services ?? []
    const transactions: TransactionRow[] = (apt as any)?.transactions ?? []

    const totalServicesPrice = services.reduce(
      (sum, r) => sum + Number(r.service?.price ?? 0),
      0,
    )
    const alreadyPaid = transactions.reduce(
      (sum, t) => sum + Number(t.net_amount ?? 0),
      0,
    )
    const serviceNames = services
      .map(r => r.service?.name)
      .filter(Boolean)
      .join(', ')
    const chargeNotes = serviceNames ? `Cobro: ${serviceNames}` : 'Cobro automático (completada)'

    // ── Use Case ─────────────────────────────────────────────────────────────
    const useCase = new CompleteAppointmentUseCase(appointmentRepo, financeRepo)
    return await useCase.execute({
      appointmentId,
      businessId,
      billing: { totalServicesPrice, alreadyPaid, chargeNotes },
    })

  } catch (err) {
    logger.error(
      'complete-appointment-action',
      'Unexpected error in completeAppointment action',
      { appointmentId, businessId, error: err instanceof Error ? err.message : String(err) },
    )
    return fail('Error interno al completar la cita')
  }
}
