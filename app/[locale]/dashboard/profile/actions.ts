'use server'

import { z } from 'zod'
import { getContainer } from '@/lib/container'
import { revalidatePath } from 'next/cache'

// ── Zod schemas ───────────────────────────────────────────────────────────
const UpdateProfileSchema = z.object({
  name:  z.string().min(1, 'El nombre es obligatorio').max(100),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Email inválido').optional(),
})

const ChangePasswordSchema = z.object({
  password:        z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Las contraseñas no coinciden.',
  path: ['confirmPassword'],
})

// ── Action result type ────────────────────────────────────────────────────
interface ProfileResult {
  error?: string
  success?: string
}

export async function updateProfile(formData: FormData): Promise<ProfileResult> {
  const container = await getContainer()

  // 1. Auth guard
  const ctx = await container.users.getBusinessContext()
  if (!ctx.data?.userId) return { error: 'No autenticado' }
  const userId = ctx.data.userId

  // 2. Validate profile fields
  const profileParsed = UpdateProfileSchema.safeParse({
    name:  formData.get('name'),
    phone: formData.get('phone'),
    email: formData.get('email'),
  })

  if (!profileParsed.success) {
    return { error: profileParsed.error.errors[0]?.message ?? 'Datos inválidos' }
  }

  const { name, phone } = profileParsed.data

  // 3. Validate password only if provided
  const rawPassword        = (formData.get('password') as string | null)?.trim() ?? ''
  const rawConfirmPassword = (formData.get('confirmPassword') as string | null)?.trim() ?? ''

  if (rawPassword) {
    const pwParsed = ChangePasswordSchema.safeParse({
      password:        rawPassword,
      confirmPassword: rawConfirmPassword,
    })

    if (!pwParsed.success) {
      return { error: pwParsed.error.errors[0]?.message ?? 'Error en la contraseña' }
    }
  }

  // 4. Update user table via container
  const updateResult = await container.users.updateProfile(userId, { name, phone: phone || null })
  if (updateResult.error) return { error: updateResult.error }

  // 5. Change password (auth infra — stays in action)
  if (rawPassword) {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { error: pwError } = await supabase.auth.updateUser({ password: rawPassword })
    if (pwError) {
      if (pwError.message.toLowerCase().includes('different from the old password')) {
        return { error: 'La nueva contraseña debe ser diferente a la actual.' }
      }
      return { error: 'Error al cambiar contraseña: ' + pwError.message }
    }
  }

  // 6. Change email (auth infra — stays in action)
  const email = profileParsed.data.email
  if (email) {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser && email !== authUser.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email })
      if (emailError) return { error: 'Error al cambiar email: ' + emailError.message }
      revalidatePath('/dashboard/profile')
      return { success: 'Perfil actualizado. Revisa tu nuevo correo para confirmar el cambio de email.' }
    }
  }

  revalidatePath('/dashboard/profile')
  return { success: 'Perfil actualizado correctamente.' }
}

export async function updateAvatar(url: string): Promise<ProfileResult> {
  const container = await getContainer()

  // Auth guard
  const ctx = await container.users.getBusinessContext()
  if (!ctx.data?.userId) return { error: 'No autenticado' }

  // Update avatar via container
  const result = await container.users.updateAvatar(ctx.data.userId, url)
  if (result.error) return { error: result.error }

  revalidatePath('/dashboard/profile')
  return { success: 'Imagen actualizada' }
}