'use server'

import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TeamMember, CreateEmployeePayload, UpdateEmployeePayload } from '@/lib/repositories/users.repo'

// ── Schemas ─────────────────────────────────────────────────────────────────

const CreateEmployeeSchema = z.object({
  businessId: z.string().uuid(),
  name:       z.string().min(1, 'El nombre es obligatorio').max(100),
  email:      z.string().email('Correo inválido').max(200).nullable(),
  phone:      z.string().max(30).nullable(),
  color:      z.string().max(20).nullable(),
})

const UpdateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  businessId: z.string().uuid(),
  name:       z.string().min(1, 'El nombre es obligatorio').max(100).optional(),
  email:      z.string().email('Correo inválido').max(200).nullable().optional(),
  phone:      z.string().max(30).nullable().optional(),
  color:      z.string().max(20).nullable().optional(),
})

const EmployeeIdSchema = z.object({
  employeeId: z.string().uuid(),
  businessId: z.string().uuid(),
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function assertOwner(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autorizado.')

  const { data: dbUser } = await supabase
    .from('users')
    .select('role, business_id')
    .eq('id', user.id)
    .single()

  if (dbUser?.role !== 'owner') throw new Error('Solo el dueño puede gestionar el equipo.')
  return user.id
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function createEmployeeAction(
  input: z.infer<typeof CreateEmployeeSchema>
): Promise<{ success: true; data: TeamMember }> {
  const parsed = CreateEmployeeSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? 'Datos inválidos')

  await assertOwner()

  const { businessId, name, email, phone, color } = parsed.data
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('users')
    .insert({
      name,
      email,
      phone,
      color,
      business_id: businessId,
      role: 'employee',
      is_active: true,
      status: 'active',
    })
    .select('id, name, email, phone, avatar_url, color, role, is_active, created_at')
    .single()

  if (error) throw new Error(`Error creating employee: ${error.message}`)

  revalidatePath('/dashboard/team')
  return { success: true, data: data as TeamMember }
}

export async function updateEmployeeAction(
  input: z.infer<typeof UpdateEmployeeSchema>
): Promise<{ success: true }> {
  const parsed = UpdateEmployeeSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? 'Datos inválidos')

  await assertOwner()

  const { employeeId, businessId, ...payload } = parsed.data
  const admin = createAdminClient()

  const { error } = await admin
    .from('users')
    .update(payload as UpdateEmployeePayload)
    .eq('id', employeeId)
    .eq('business_id', businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error updating employee: ${error.message}`)

  revalidatePath('/dashboard/team')
  return { success: true }
}

export async function toggleEmployeeActiveAction(
  input: z.infer<typeof EmployeeIdSchema> & { currentlyActive: boolean }
): Promise<{ success: true }> {
  await assertOwner()

  const admin = createAdminClient()

  const { error } = await admin
    .from('users')
    .update({ is_active: !input.currentlyActive })
    .eq('id', input.employeeId)
    .eq('business_id', input.businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error toggling employee status: ${error.message}`)

  revalidatePath('/dashboard/team')
  return { success: true }
}

export async function deleteEmployeeAction(
  input: z.infer<typeof EmployeeIdSchema>
): Promise<{ success: true }> {
  await assertOwner()

  const admin = createAdminClient()

  const { count } = await admin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_user_id', input.employeeId)
    .eq('business_id', input.businessId)

  if (count && count > 0) {
    throw new Error(
      `No se puede eliminar: este empleado tiene ${count} cita(s) asignada(s). Desactívalo en su lugar.`
    )
  }

  const { error } = await admin
    .from('users')
    .delete()
    .eq('id', input.employeeId)
    .eq('business_id', input.businessId)
    .eq('role', 'employee')

  if (error) throw new Error(`Error deleting employee: ${error.message}`)

  revalidatePath('/dashboard/team')
  return { success: true }
}
