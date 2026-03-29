'use server'

import { z } from 'zod'
import { isPast } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import * as financesRepo from '@/lib/repositories/finances.repo'
import * as clientsRepo from '@/lib/repositories/clients.repo'

// ── Zod schema for payment registration ───────────────────────────────────
const RegisterPaymentSchema = z.object({
  business_id:     z.string().uuid('ID de negocio inválido'),
  client_id:       z.string().uuid('ID de cliente inválido'),
  amount:          z.number().positive('El monto debe ser mayor a cero.'),
  method:          z.enum(['cash', 'card', 'transfer', 'qr', 'other']),
  notes:           z.string().max(200).optional(),
  appointment_id:  z.string().uuid().optional(),
})

type RegisterPaymentInput = z.infer<typeof RegisterPaymentSchema>

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Registers a client payment (full payment or partial abono).
 * When no appointment_id is provided, distributes the payment across
 * outstanding appointments (oldest first) so debt recalculates correctly.
 */
export async function registerClientPayment(
  formData: RegisterPaymentInput
): Promise<{ success: true }> {
  // 1. Validate with Zod
  const parsed = RegisterPaymentSchema.safeParse(formData)
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Datos inválidos'
    throw new Error(firstError)
  }

  const validData = parsed.data
  const supabase = await createClient()

  // 2. Auth guard
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  // 3. If a specific appointment is provided, link directly
  if (validData.appointment_id) {
    await financesRepo.createTransaction(supabase, {
      business_id:     validData.business_id,
      amount:          validData.amount,
      net_amount:      validData.amount,
      method:          validData.method,
      notes:           validData.notes ?? null,
      appointment_id:  validData.appointment_id,
    })
  } else {
    // 4. No specific appointment — distribute across unpaid past appointments (oldest first)
    const appointments = await clientsRepo.getClientAppointments(
      supabase,
      validData.client_id,
      validData.business_id,
    )

    const unpaid = appointments
      .filter((apt) => {
        if (apt.status === 'cancelled' || apt.status === 'no_show') return false
        if (!isPast(new Date(apt.start_at))) return false
        const price = apt.service?.price ?? 0
        const paid = apt.transactions?.reduce((sum, t) => sum + (t.net_amount ?? 0), 0) ?? 0
        return price - paid > 0
      })
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())

    let remaining = validData.amount

    for (const apt of unpaid) {
      if (remaining <= 0) break
      const price = apt.service?.price ?? 0
      const paid = apt.transactions?.reduce((sum, t) => sum + (t.net_amount ?? 0), 0) ?? 0
      const owes = price - paid
      const toApply = Math.min(remaining, owes)

      await financesRepo.createTransaction(supabase, {
        business_id:    validData.business_id,
        amount:         toApply,
        net_amount:     toApply,
        method:         validData.method,
        notes:          validData.notes ?? null,
        appointment_id: apt.id,
      })

      remaining -= toApply
    }
  }

  revalidatePath(`/dashboard/clients/${validData.client_id}`)
  revalidatePath('/dashboard/finances')

  return { success: true }
}
