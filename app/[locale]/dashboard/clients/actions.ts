'use server'

import { z } from 'zod'
import { isPast } from 'date-fns'
import { getContainer } from '@/lib/container'
import { revalidatePath } from 'next/cache'
import type { Client } from '@/types'

// ── Data fetching (container pattern) ──────────────────────────────────────

export async function getClients(businessId: string): Promise<Client[]> {
  const container = await getContainer()
  const result = await container.clients.getAll(businessId)
  return result.data ?? []
}

export async function getClientDetail(clientId: string, businessId: string) {
  const container = await getContainer()
  const clientRes = await container.clients.getById(clientId, businessId)
  const client = clientRes.error ? null : clientRes.data
  if (!client) return null

  const aptsRes = await container.clients.getAppointments(client.id, businessId)
  const clientAppointments = aptsRes.data ?? []

  return { client, clientAppointments }
}

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
  const container = await getContainer()

  // 2. Auth guard
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  // 3. If a specific appointment is provided, link directly
  if (validData.appointment_id) {
    const txResult = await container.finances.createTransaction({
      business_id:     validData.business_id,
      amount:          validData.amount,
      net_amount:      validData.amount,
      method:          validData.method,
      notes:           validData.notes ?? null,
      appointment_id:  validData.appointment_id,
    })
    if (txResult.error) throw new Error(txResult.error)
  } else {
    // 4. No specific appointment — distribute across unpaid past appointments (oldest first)
    const apptResult = await container.clients.getAppointments(
      validData.client_id,
      validData.business_id,
    )
    const appointments = apptResult.data ?? []

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

      const txResult = await container.finances.createTransaction({
        business_id:    validData.business_id,
        amount:         toApply,
        net_amount:     toApply,
        method:         validData.method,
        notes:          validData.notes ?? null,
        appointment_id: apt.id,
      })
      if (txResult.error) throw new Error(txResult.error)

      remaining -= toApply
    }
  }

  revalidatePath(`/dashboard/clients/${validData.client_id}`)
  revalidatePath('/dashboard/finances')

  return { success: true }
}
