'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { registerSchema } from '@/lib/validations/auth'
import { headers } from 'next/headers'

export async function register(formData: FormData) {
  const data = Object.fromEntries(formData.entries())

  const result = registerSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Datos de registro inválidos' }
  }

  const { firstName, lastName, bizName, bizCategory, email, password } = result.data
  const supabase = await createClient()
  const admin = createAdminClient()

  // Verificar que el email no esté registrado antes de crear el auth user
  const { data: existingUser } = await admin
    .from('users')
    .select('id, provider')
    .eq('email', email)
    .maybeSingle()

  if (existingUser) {
    const method = existingUser.provider === 'google' ? 'Google' : 'correo y contraseña'
    return { error: `Ya existe una cuenta con este correo (registrada con ${method}). Inicia sesión en lugar de registrarte.` }
  }

  // Determinar la URL base: priorizar variable de entorno de producción,
  // luego el origin del request (útil en local).
  const requestHeaders = await headers()
  const origin = requestHeaders.get('origin') ?? ''
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? origin

  // 1. Crear usuario en Auth con emailRedirectTo explícito para evitar
  //    que el link del correo apunte a localhost en dispositivos móviles.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // biz_name stored in user_metadata so the callback can auto-create
      // the business after email confirmation — user never sees /setup
      data: {
        full_name:    `${firstName} ${lastName}`.trim(),
        biz_name:     bizName,
        biz_category: bizCategory,
      },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    }
  })

  if (authError) return { error: authError.message }

  const user = authData.user
  if (!user) return { error: 'No se pudo crear el usuario.' }

  // 2. Si hay confirmación de email pendiente, avisar al usuario
  // El negocio se creará cuando confirme el email y haga login → /dashboard/setup
  if (authData.session === null) {
    return {
      success: '¡Cuenta creada! Revisa tu correo electrónico y confirma tu cuenta para continuar.'
    }
  }

  // 3. Si no requiere confirmación (raro), crear el negocio directamente.
  //    El trigger on_auth_user_created ya creó el row en public.users.
  const { data: bizData, error: bizError } = await supabase
    .from('businesses')
    .insert({
      name:     bizName,
      owner_id: user.id,
      category: bizCategory,
      plan:     'pro',
    })
    .select()
    .single()

  if (bizError) {
    // Log structured error — user sees generic message below
    const { logger } = await import('@/lib/logger')
    logger.error('register', 'Error creating business', bizError)
    return { error: 'Error al crear el negocio: ' + bizError.message }
  }

  // 4. Vincular usuario al negocio y activarlo (usa admin para evitar restricciones RLS)
  const { error: linkError } = await admin
    .from('users')
    .update({
      name: `${firstName} ${lastName}`.trim(),
      business_id: bizData.id,
      role: 'owner',
      status: 'active',
    })
    .eq('id', user.id)

  if (linkError) {
    const { logger } = await import('@/lib/logger')
    logger.error('register', 'Error linking user to business', linkError)
    return { error: 'Error al vincular tu cuenta con el negocio. Intenta iniciar sesión.' }
  }

  return {
    success: '¡Cuenta creada! Revisa tu correo electrónico y confirma tu cuenta para iniciar sesión.'
  }
}