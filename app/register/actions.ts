'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function register(formData: FormData) {
  const supabase = createClient()

  const firstName = formData.get('firstName') as string
  const lastName = formData.get('lastName') as string
  const bizName = formData.get('bizName') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // 1. Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: `${firstName} ${lastName}`.trim(),
      }
    }
  })

  if (authError) {
    return { error: authError.message }
  }

  const user = authData.user
  if (!user) {
    return { error: 'No se pudo crear el usuario.' }
  }

  // 2. Create the business
  const { data: bizData, error: bizError } = await supabase
    .from('businesses')
    .insert({
      name: bizName,
      owner_id: user.id,
      category: 'General', // Default category
    })
    .select()
    .single()

  if (bizError) {
    return { error: 'Error al crear el negocio: ' + bizError.message }
  }

  // 3. Create the user record in public.users
  const { error: userError } = await supabase
    .from('users')
    .insert({
      id: user.id,
      name: `${firstName} ${lastName}`.trim(),
      email: email,
      business_id: bizData.id,
      role: 'owner',
    })

  if (userError) {
    return { error: 'Error al crear el perfil de usuario: ' + userError.message }
  }

  redirect('/dashboard')
}
