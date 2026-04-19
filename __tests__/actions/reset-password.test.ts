import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

import { resetPassword } from '@/app/[locale]/reset-password/actions'
import { createClient } from '@/lib/supabase/server'

function makeSupabase(updateError: unknown = null) {
  return {
    auth: { updateUser: vi.fn().mockResolvedValue({ error: updateError }) },
  }
}

describe('resetPassword server action', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects to login on successful password update', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('password', 'NewSecure123!')
    fd.append('confirmPassword', 'NewSecure123!')

    await expect(resetPassword(fd)).rejects.toThrow(/REDIRECT:.*login/)
  })

  it('calls updateUser with the new password', async () => {
    const supabase = makeSupabase()
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const fd = new FormData()
    fd.append('password', 'NewSecure123!')
    fd.append('confirmPassword', 'NewSecure123!')

    await resetPassword(fd).catch(() => {})

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'NewSecure123!' })
  })

  it('returns validation error when passwords do not match', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('password', 'NewSecure123!')
    fd.append('confirmPassword', 'DifferentPass456!')

    const result = await resetPassword(fd)

    expect((result as { error?: string })?.error).toBeTruthy()
  })

  it('returns validation error for password too short', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('password', 'short')
    fd.append('confirmPassword', 'short')

    const result = await resetPassword(fd)

    expect((result as { error?: string })?.error).toBeTruthy()
  })

  it('returns Supabase error message when update fails', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ message: 'Invalid session token' }) as never
    )

    const fd = new FormData()
    fd.append('password', 'NewSecure123!')
    fd.append('confirmPassword', 'NewSecure123!')

    const result = await resetPassword(fd)

    expect((result as { error?: string })?.error).toBe('Invalid session token')
  })
})
