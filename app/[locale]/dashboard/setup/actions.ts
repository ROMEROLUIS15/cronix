'use server'

import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
// createAdminClient is still needed for getUserContextById (bypasses recursive RLS on users table)
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getRepos } from '@/lib/repositories'

// ── Zod schema for business creation ──────────────────────────────────────
const CreateBusinessSchema = z.object({
  name:     z.string().min(1, 'El nombre es obligatorio').max(100).transform(s => s.trim()),
  category: z.string().min(1, 'La categoría es requerida'),
})

// ── Action state type ─────────────────────────────────────────────────────
interface CreateBusinessState {
  error?: string
  success?: true
}

export async function createBusiness(
  prevState: CreateBusinessState | null,
  formData: FormData
): Promise<CreateBusinessState> {
  const supabase = await createClient()

  // 1. Auth guard
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  // platform_admin never creates a business — read role via admin client
  // (bypasses the recursive RLS policy on the users table)
  const adminClient = createAdminClient()
  const { users: usersRepoInstance } = getRepos(adminClient)
  const callerCtx = await usersRepoInstance.getUserContextById(user.id)
  const callerUser = callerCtx.data

  if (callerUser?.role === 'platform_admin') {
    redirect('/dashboard')
  }

  // 2. Validate input
  const parsed = CreateBusinessSchema.safeParse({
    name:     formData.get('name'),
    category: formData.get('category'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Datos inválidos'
    return { error: firstError }
  }

  const { name, category } = parsed.data
  const timezone = (formData.get('timezone') as string) || 'America/Caracas'

  // 3. Check if user already has a business (reuse the callerUser query above)
  if (callerUser?.business_id) {
    redirect('/dashboard')
  }

  // 4+5. Atomically create business AND link owner in one DB transaction.
  // The RPC fn_create_business_and_link_owner uses SECURITY DEFINER, so it
  // can UPDATE users.business_id without requiring the admin client here.
  const repos = getRepos(supabase)
  const ownerName =
    (user.user_metadata as Record<string, string> | null)?.full_name ||
    user.email?.split('@')[0] ||
    'Usuario'

  const businessResult = await repos.businesses.createWithOwnerLink({
    ownerId:    user.id,
    ownerName,
    ownerEmail: user.email ?? '',
    name,
    category,
    timezone,
    plan: 'pro',
  })

  if (businessResult.error) {
    return { error: 'Error al crear el negocio: ' + businessResult.error }
  }

  revalidatePath('/dashboard')
  // Return success so the client can clear the React Query cache before navigating.
  // Calling redirect() here would bypass the client-side cache invalidation and
  // cause the dashboard to render with stale null businessId, triggering the setup loop.
  return { success: true as const }
}