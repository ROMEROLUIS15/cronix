'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email    = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      return {
        error: 'Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.',
      }
    }
    return { error: 'Correo o contraseña incorrectos.' }
  }

  redirect('/dashboard')
}

/**
 * Google OAuth — LOGIN only.
 * Unregistered users are blocked in /auth/callback.
 */
export async function signInWithGoogle() {
  const supabase = await createClient()
  const origin   = (await headers()).get('origin')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:  `${origin}/auth/callback?next=/dashboard`,
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) return { error: error.message }
  if (data.url) redirect(data.url)
  return { error: 'No se pudo generar el enlace de Google.' }
}

/**
 * Google OAuth — REGISTER only.
 * intent=signup tells /auth/callback to create the user in public.users.
 */
export async function signUpWithGoogle() {
  const supabase = await createClient()
  const origin   = (await headers()).get('origin')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:  `${origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) return { error: error.message }
  if (data.url) redirect(data.url)
  return { error: 'No se pudo generar el enlace de Google.' }
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
