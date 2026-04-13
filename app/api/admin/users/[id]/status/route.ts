import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Database } from '@/types/database.types'

type UserStatus = Database['public']['Enums']['user_status']

const VALID_STATUSES: UserStatus[] = ['active', 'pending', 'rejected']

/**
 * PATCH /api/admin/users/[id]/status
 * Changes a user's status (active | pending | rejected).
 * Protected: only platform_admin can call this.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetUserId } = await params

  // 1. Verify caller identity via session
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Verify caller is platform_admin
  const { data: caller } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()

  if (!caller || caller.role !== 'platform_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Parse and validate body
  const body = await req.json().catch(() => null)
  const status = body?.status as UserStatus | undefined

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  // 4. Prevent self-modification
  if (targetUserId === authUser.id) {
    return NextResponse.json({ error: 'Cannot modify your own status' }, { status: 400 })
  }

  // 5. Update via admin client (bypasses RLS)
  const adminClient = createAdminClient()
  const { data: updated, error } = await adminClient
    .from('users')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', targetUserId)
    .select('id, name, email, status')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ user: updated })
}
