'use server'

import { z } from 'zod'
import { isPast } from 'date-fns'
import { getContainer } from '@/lib/container'
import { revalidatePath } from 'next/cache'
import type { Client } from '@/types'
import type { BatchTransactionItem } from '@/lib/domain/repositories/IFinanceRepository'
import { getClientLimit } from '@/lib/plans/plan-limits'
import { getTranslations } from 'next-intl/server'

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

export async function getClientDebts(businessId: string): Promise<Record<string, number>> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  // Fetch only relevant past appointments with their costs and transactions
  const { data: apts } = await supabase
    .from('appointments')
    .select('client_id, service:services(price), transactions(net_amount)')
    .eq('business_id', businessId)
    .not('status', 'in', '("cancelled","no_show")')
    .lt('start_at', new Date().toISOString())

  const debts: Record<string, number> = {}
  
  if (!apts) return debts
  
  apts.forEach((apt: any) => {
    if (!apt.client_id) return
    const price = apt.service?.price ?? 0
    // sum transactions if any
    const paid = Array.isArray(apt.transactions) 
      ? apt.transactions.reduce((sum: number, t: any) => sum + Number(t.net_amount ?? 0), 0)
      : 0
    const owes = price - paid
    
    if (owes > 0) {
      debts[apt.client_id] = (debts[apt.client_id] ?? 0) + owes
    }
  })

  return debts
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deriva el business_id del usuario autenticado a partir de la sesión.
 * SECURITY: nunca confiar en el business_id que envía el cliente (defensa en
 * profundidad sobre RLS) — un input manipulado no puede escribir en otro negocio.
 * Usa el admin client solo para la lectura de contexto (evita la RLS recursiva
 * sobre la tabla users).
 */
async function getSessionBusinessId(): Promise<string> {
  const { createClient, createAdminClient } = await import('@/lib/supabase/server')
  const { getRepos } = await import('@/lib/repositories')

  // La identidad del usuario se lee del client ligado a las cookies de sesión:
  // el admin client (service_role) no transporta el JWT del usuario, por lo que
  // auth.getUser() sobre él devuelve siempre null.
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  // La lectura de contexto usa el admin client para evitar la RLS recursiva
  // sobre la tabla users.
  const admin = createAdminClient()
  const { users } = getRepos(admin)
  const ctx = await users.getUserContextById(user.id)
  if (ctx.error || !ctx.data?.business_id) {
    throw new Error('No se pudo verificar el negocio del usuario.')
  }
  return ctx.data.business_id
}

// ── New client creation ────────────────────────────────────────────────────

export async function createNewClient(input: {
  businessId: string
  name: string
  phone: string
  email?: string
  tags?: string[]
}): Promise<{ error: string | null }> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  // SECURITY: el business_id se deriva de la sesión, no del input del cliente.
  const businessId = await getSessionBusinessId()

  // Plan limit check
  const { data: biz } = await supabase
    .from('businesses')
    .select('plan')
    .eq('id', businessId)
    .single()

  const limit = getClientLimit(biz?.plan ?? 'free')
  if (isFinite(limit)) {
    const { count } = await supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .is('deleted_at', null)

    if ((count ?? 0) >= limit) {
      const t = await getTranslations('settings.plan.limitErrors')
      return { error: t('clients', { limit }) }
    }
  }

  const container = await getContainer()
  const result = await container.clients.insert({
    business_id: businessId,
    name: input.name,
    phone: input.phone,
    email: input.email,
  })

  if (result.error) {
    // DB-level unique constraints enforce phone+email uniqueness per business
    // (idx_clients_business_phone_digits / idx_clients_business_email_norm).
    // The legacy clients_business_phone_unique_key is dropped in migration
    // 20260611120000 but is still matched here so the message stays friendly even
    // before that migration is applied. Map the constraint name to a friendly
    // message so the UI never surfaces raw Postgres errors.
    if (
      result.error.includes('idx_clients_business_phone_digits') ||
      result.error.includes('clients_business_phone_unique_key')
    ) {
      return { error: 'Ya tienes un cliente activo con ese número de teléfono.' }
    }
    if (result.error.includes('idx_clients_business_email_norm')) {
      return { error: 'Ya tienes un cliente activo con ese correo.' }
    }
    return { error: 'Error al crear el cliente: ' + result.error }
  }

  const { notificationForNewClient } = await import('@/lib/use-cases/notifications.use-case')
  const notifPayload = notificationForNewClient(businessId, input.name, input.phone)
  container.notifications.create(notifPayload).catch(() => null)

  revalidatePath('/dashboard/clients')
  return { error: null }
}

// ── Zod schema for payment registration ───────────────────────────────────
const RegisterPaymentSchema = z.object({
  business_id:      z.string().uuid('ID de negocio inválido'),
  client_id:        z.string().uuid('ID de cliente inválido'),
  amount:           z.number().positive('El monto debe ser mayor a cero.'),
  method:           z.enum(['cash', 'card', 'transfer', 'qr', 'other']),
  notes:            z.string().max(200).optional(),
  appointment_id:   z.string().uuid().optional(),
  idempotency_key:  z.string().uuid().optional(),
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

  // 2. Auth guard — business_id derived from session, never trusted from input.
  const businessId = await getSessionBusinessId()

  // 3. If a specific appointment is provided, link directly
  if (validData.appointment_id) {
    const txResult = await container.finances.createTransaction({
      business_id:      businessId,
      amount:           validData.amount,
      net_amount:       validData.amount,
      method:           validData.method,
      notes:            validData.notes ?? null,
      appointment_id:   validData.appointment_id,
      idempotency_key:  validData.idempotency_key,
    })
    if (txResult.error) throw new Error(txResult.error)
  } else {
    // 4. No specific appointment — distribute across unpaid past appointments (oldest first).
    // Distribution logic runs in TypeScript; atomicity is delegated to createTransactionBatch
    // so all inserts succeed or all are rolled back together.
    const apptResult = await container.clients.getAppointments(
      validData.client_id,
      businessId,
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

    const batchItems: BatchTransactionItem[] = []
    let remaining = validData.amount
    let aptIndex  = 0

    for (const apt of unpaid) {
      if (remaining <= 0) break
      const price = apt.service?.price ?? 0
      const paid = apt.transactions?.reduce((sum, t) => sum + (t.net_amount ?? 0), 0) ?? 0
      const owes = price - paid
      const toApply = Math.min(remaining, owes)

      // Derive a stable per-appointment key from the base key so distributing a
      // payment across N appointments produces N idempotent inserts.
      const aptKey = validData.idempotency_key
        ? `${validData.idempotency_key}-${aptIndex}`
        : undefined

      batchItems.push({
        amount:          toApply,
        net_amount:      toApply,
        method:          validData.method,
        notes:           validData.notes ?? null,
        appointment_id:  apt.id,
        idempotency_key: aptKey,
      })

      remaining -= toApply
      aptIndex++
    }

    if (batchItems.length > 0) {
      const batchResult = await container.finances.createTransactionBatch(
        businessId,
        batchItems,
      )
      if (batchResult.error) throw new Error(batchResult.error)
    }
  }

  revalidatePath(`/dashboard/clients/${validData.client_id}`)
  revalidatePath('/dashboard/finances')

  return { success: true }
}
