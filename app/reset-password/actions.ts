'use server'

import { createClient } from '@/lib/supabase/server'
import { resetPasswordSchema } from '@/lib/validations/auth'
import { redirect } from 'next/navigation'

export async function resetPassword(formData: FormData) {
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string
  
  const result = resetPasswordSchema.safeParse({ password, confirmPassword })
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  // Actualizar la contraseña del usuario actualmente en la sesión (el token de recuperación ya autenticó al usuario temporalmente)
  const { error } = await supabase.auth.updateUser({
    password: password,
  })

  if (error) {
    return { error: error.message }
  }

  redirect('/login?message=Contraseña actualizada correctamente. Ya puedes iniciar sesión.')
}
