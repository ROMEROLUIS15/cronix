'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createBusiness(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const name = formData.get('name') as string
  const category = formData.get('category') as string

  if (!name?.trim() || !category) {
    return { error: 'Nombre y categoría son requeridos' }
  }

  // Verificar si ya tiene negocio
  const { data: existingUser } = await supabase
    .from('users').select('business_id').eq('id', user.id).single()

  if (existingUser?.business_id) {
    redirect('/dashboard')
  }

  // 1. Crear el negocio
  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .insert({
      name: name.trim(),
      category,
      owner_id: user.id,
      plan: 'pro',
    })
    .select()
    .single()

  if (bizError) {
    console.error('Error creating business:', bizError)
    return { error: 'No se pudo crear el negocio. Error: ' + bizError.message }
  }

  // 2. Asegurar que existe el perfil y vincularlo al negocio
  const { error: upsertError } = await supabase
    .from('users')
    .upsert({
      id: user.id,
      name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario',
      email: user.email ?? '',
      business_id: business.id,
      role: 'owner',
    }, { onConflict: 'id' })

  if (upsertError) {
    console.error('Error upserting user:', upsertError)
    return { error: 'Error vinculando el perfil al negocio: ' + upsertError.message }
  }

  revalidatePath('/dashboard')
  redirect('/dashboard')
}