'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateProfile(formData: FormData) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const name            = formData.get('name') as string
  const phone           = formData.get('phone') as string
  const email           = formData.get('email') as string
  const password        = (formData.get('password') as string)?.trim()
  const confirmPassword = (formData.get('confirmPassword') as string)?.trim()

  // 1. Validar contraseña solo si el usuario quiere cambiarla
  if (password) {
    if (password.length < 6) {
      return { error: 'La contraseña debe tener al menos 6 caracteres.' }
    }
    if (password !== confirmPassword) {
      return { error: 'Las contraseñas no coinciden.' }
    }
  }

  // 2. Actualizar tabla users
  const { error: userError } = await supabase
    .from('users')
    .update({ name, phone })
    .eq('id', user.id)

  if (userError) return { error: userError.message }

  // 3. Cambiar contraseña SOLO si se proporcionó
  if (password) {
    const { error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError) {
      if (pwError.message.toLowerCase().includes('different from the old password')) {
        return { error: 'La nueva contraseña debe ser diferente a la actual.' }
      }
      return { error: 'Error al cambiar contraseña: ' + pwError.message }
    }
  }

  // 4. Cambiar email SOLO si cambió
  if (email && email !== user.email) {
    const { error: emailError } = await supabase.auth.updateUser({ email })
    if (emailError) return { error: 'Error al cambiar email: ' + emailError.message }
    revalidatePath('/dashboard/profile')
    return { success: 'Perfil actualizado. Revisa tu nuevo correo para confirmar el cambio de email.' }
  }

  revalidatePath('/dashboard/profile')
  return { success: 'Perfil actualizado correctamente.' }
}

export async function updateAvatar(url: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { error } = await supabase.from('users').update({ avatar_url: url }).eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/profile')
  return { success: 'Imagen actualizada' }
}