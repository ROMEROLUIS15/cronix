'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getRepos } from '@/lib/repositories'
import { withActionRateLimit } from '@/lib/actions/rate-limit-action'
import type { TeamMember, UpdateEmployeePayload } from '@/lib/domain/repositories/IUserRepository'

// ── Schemas ─────────────────────────────────────────────────────────────────

const CreateEmployeeSchema = z.object({
  name:       z.string().min(1, 'El nombre es obligatorio').max(100),
  email:      z.string().email('Correo inválido').max(200).nullable(),
  phone:      z.string().max(30).nullable(),
  color:      z.string().max(20).nullable(),
})

const UpdateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  name:       z.string().min(1, 'El nombre es obligatorio').max(100).optional(),
  email:      z.string().email('Correo inválido').max(200).nullable().optional(),
  phone:      z.string().max(30).nullable().optional(),
  color:      z.string().max(20).nullable().optional(),
})

const EmployeeIdSchema = z.object({
  employeeId: z.string().uuid(),
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifies the current user is an owner and returns their business context.
 * SECURITY: Derives business_id from the authenticated session, NOT from client input.
 */
async function assertOwnerAndGetBusinessContext(): Promise<{ userId: string; businessId: string }> {
  const supabase = await createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  const { users: usersRepoInstance } = getRepos(supabase)
  const ctxResult = await usersRepoInstance.getUserContextById(user.id)
  if (ctxResult.error || !ctxResult.data) throw new Error('No se pudo verificar el rol del usuario.')
  if (!ctxResult.data.business_id) throw new Error('El usuario no pertenece a ningún negocio.')
  if (ctxResult.data.role !== 'owner') throw new Error('Solo el dueño puede gestionar el equipo.')

  return { userId: user.id, businessId: ctxResult.data.business_id }
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function createEmployeeAction(
  input: z.infer<typeof CreateEmployeeSchema>
): Promise<{ success: true; data: TeamMember }> {
  const parsed = CreateEmployeeSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos')

  // SECURITY: businessId comes from session, not from client input
  const { businessId } = await assertOwnerAndGetBusinessContext()
  const payload = parsed.data

  return await withActionRateLimit('team-create', 10, 60, async () => {
    const admin = createAdminClient()
    const { users: usersRepoInstance } = getRepos(admin)

    const result = await usersRepoInstance.createEmployee(businessId, payload)
    if (result.error) throw new Error(result.error)
    if (!result.data) throw new Error('No se pudo crear el empleado.')

    revalidatePath('/dashboard/team')
    return { success: true as const, data: result.data }
  }) as { success: true; data: TeamMember }
}

export async function updateEmployeeAction(
  input: z.infer<typeof UpdateEmployeeSchema>
): Promise<{ success: true }> {
  const parsed = UpdateEmployeeSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos')

  // SECURITY: businessId comes from session, not from client input
  const { businessId } = await assertOwnerAndGetBusinessContext()
  const { employeeId, ...payload } = parsed.data

  return await withActionRateLimit('team-update', 20, 60, async () => {
    const admin = createAdminClient()
    const { users: usersRepoInstance } = getRepos(admin)

    const result = await usersRepoInstance.updateEmployee(employeeId, businessId, payload as UpdateEmployeePayload)
    if (result.error) throw new Error(result.error)

    revalidatePath('/dashboard/team')
    return { success: true as const }
  }) as { success: true }
}

export async function toggleEmployeeActiveAction(
  input: z.infer<typeof EmployeeIdSchema> & { currentlyActive: boolean }
): Promise<{ success: true }> {
  // SECURITY: businessId comes from session, not from client input
  const { businessId } = await assertOwnerAndGetBusinessContext()

  return await withActionRateLimit('team-toggle', 20, 60, async () => {
    const admin = createAdminClient()
    const { users: usersRepoInstance } = getRepos(admin)

    const result = await usersRepoInstance.toggleEmployeeActive(input.employeeId, businessId, input.currentlyActive)
    if (result.error) throw new Error(result.error)

    revalidatePath('/dashboard/team')
    return { success: true as const }
  }) as { success: true }
}

export async function deleteEmployeeAction(
  input: z.infer<typeof EmployeeIdSchema>
): Promise<{ success: true }> {
  // SECURITY: businessId comes from session, not from client input
  const { businessId } = await assertOwnerAndGetBusinessContext()

  return await withActionRateLimit('team-delete', 5, 60, async () => {
    const admin = createAdminClient()
    const { users: usersRepoInstance } = getRepos(admin)

    const result = await usersRepoInstance.deleteEmployee(input.employeeId, businessId)
    if (result.error) throw new Error(result.error)

    revalidatePath('/dashboard/team')
    return { success: true as const }
  }) as { success: true }
}
