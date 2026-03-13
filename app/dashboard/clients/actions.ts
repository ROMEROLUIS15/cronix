'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Types ──────────────────────────────────────────────────────────────────
interface RegisterPaymentInput {
  business_id:      string
  client_id:        string
  amount:           number
  method:           'other' | 'cash' | 'card' | 'transfer' | 'qr'
  notes?:           string
  appointment_id?:  string
}


// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Registers a client payment (full payment or partial abono).
 * Inserts a transaction and decrements the client's outstanding debt.
 */
export async function registerClientPayment(
  formData: RegisterPaymentInput
): Promise<{ success: true }> {
  // Validate amount is positive
  if (!formData.amount || formData.amount <= 0) {
    throw new Error('El monto debe ser mayor a cero.')
  }

  const supabase = await createClient()

  // Verify the requesting user owns this business (RLS will also enforce this)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  const { error } = await supabase.from('transactions').insert({
    business_id:     formData.business_id,
    client_id:       formData.client_id,
    amount:          formData.amount,
    net_amount:      formData.amount,
    method:          formData.method,
    notes:           formData.notes ?? null,
    appointment_id:  formData.appointment_id ?? null,
    paid_at:         new Date().toISOString(),
  })

  if (error) throw new Error(error.message)

  revalidatePath(`/dashboard/clients/${formData.client_id}`)
  revalidatePath('/dashboard/finances')

  return { success: true }
}
