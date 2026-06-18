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

  // Business hours captured at onboarding → stored in the dashboard's canonical
  // shape (settings.workingHours: { mon: [open, close] | null, … }), which the
  // WhatsApp and voice agents read. Mon–Sat get the chosen span; Sunday only if
  // the owner opted in. So no business starts without a usable schedule.
  const open  = (formData.get('open')  as string) || '09:00'
  const close = (formData.get('close') as string) || '18:00'
  const sundayOpen = formData.get('sunday_open') === '1'
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!TIME_RE.test(open) || !TIME_RE.test(close) || open >= close) {
    return { error: 'El horario de cierre debe ser posterior al de apertura.' }
  }
  const span: [string, string] = [open, close]
  const workingHours: Record<string, [string, string] | null> = {
    mon: span, tue: span, wed: span, thu: span, fri: span, sat: span,
    sun: sundayOpen ? span : null,
  }

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
    plan: 'free',
  })

  if (businessResult.error) {
    return { error: 'Error al crear el negocio: ' + businessResult.error }
  }

  // Seed the working hours onto the freshly created business (merge — never clobber
  // any defaults the RPC set). Non-fatal: if it fails the business still exists and
  // the owner can set hours in Settings.
  const newBiz = businessResult.data
  if (newBiz?.id) {
    const currentSettings = (newBiz.settings ?? {}) as Record<string, unknown>
    await repos.businesses.updateSettings(newBiz.id, { ...currentSettings, workingHours })
  }

  revalidatePath('/dashboard')
  // Return success so the client can clear the React Query cache before navigating.
  // Calling redirect() here would bypass the client-side cache invalidation and
  // cause the dashboard to render with stale null businessId, triggering the setup loop.
  return { success: true as const }
}