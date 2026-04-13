'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'
import { registerSchema } from '@/lib/validations/auth'
import { headers } from 'next/headers'

export async function register(formData: FormData) {
  const data = Object.fromEntries(formData.entries())

  const result = registerSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Datos de registro inválidos' }
  }

  const { firstName, lastName, bizName, bizCategory, email, password } = result.data
  const timezone = (data.timezone as string) || 'America/Caracas'
  const supabase = await createClient()
  const admin = createAdminClient()
  const { users: usersRepoInstance } = getRepos(admin)

  // Verificar que el email no esté registrado antes de crear el auth user
  const existingCheck = await usersRepoInstance.getUserProfileByEmail(email)

  if (existingCheck.data) {
    const existingUser = existingCheck.data
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
        biz_timezone: timezone,
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
  const repos = getRepos(supabase)
  const businessResult = await repos.businesses.create({
    name: bizName,
    category: bizCategory,
    owner_id: user.id,
    timezone,
    plan: 'pro',
  })

  if (businessResult.error) {
    const { logger } = await import('@/lib/logger')
    logger.error('register', 'Error creating business', businessResult.error)
    return { error: 'Error al crear el negocio: ' + businessResult.error }
  }
  const bizData = businessResult.data
  if (!bizData) return { error: 'Error al crear el negocio.' }

  // 4. Vincular usuario al negocio y activarlo (usa admin para evitar restricciones RLS)
  const linkResult = await usersRepoInstance.linkUserToBusiness(user.id, {
    name: `${firstName} ${lastName}`.trim(),
    business_id: bizData.id,
    role: 'owner',
    status: 'active',
  })

  if (linkResult.error) {
    const { logger } = await import('@/lib/logger')
    logger.error('register', 'Error linking user to business', linkResult.error)
    return { error: 'Error al vincular tu cuenta con el negocio. Intenta iniciar sesión.' }
  }

  return {
    success: '¡Cuenta creada! Revisa tu correo electrónico y confirma tu cuenta para iniciar sesión.'
  }
}