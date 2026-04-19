import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => 'http://localhost:3000' }),
}))

import { forgotPassword } from '@/app/[locale]/forgot-password/actions'
import { createClient } from '@/lib/supabase/server'

function makeSupabase(resetError: unknown = null) {
  return {
    auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: resetError }) },
  }
}

describe('forgotPassword server action', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns ambiguous success message for valid email', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('email', 'user@example.com')
    const result = await forgotPassword(fd)

    expect((result as { error?: unknown }).error).toBeUndefined()
    expect((result as { success?: string }).success).toBeTruthy()
  })

  it('calls resetPasswordForEmail with correct email and redirect URL', async () => {
    const supabase = makeSupabase()
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const fd = new FormData()
    fd.append('email', 'test@cronix.app')
    await forgotPassword(fd)

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'test@cronix.app',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') })
    )
  })

  it('returns validation error for invalid email format', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('email', 'not-an-email')
    const result = await forgotPassword(fd)

    expect((result as { error?: string }).error).toBeTruthy()
  })

  it('returns validation error for empty email', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd = new FormData()
    fd.append('email', '')
    const result = await forgotPassword(fd)

    expect((result as { error?: string }).error).toBeTruthy()
  })

  it('propagates Supabase error message', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ message: 'Rate limit exceeded' }) as never
    )

    const fd = new FormData()
    fd.append('email', 'user@example.com')
    const result = await forgotPassword(fd)

    expect((result as { error?: string }).error).toBe('Rate limit exceeded')
  })

  it('returns same success message regardless of whether account exists', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as never)

    const fd1 = new FormData()
    fd1.append('email', 'existing@cronix.app')
    const r1 = await forgotPassword(fd1)

    const fd2 = new FormData()
    fd2.append('email', 'nonexistent@cronix.app')
    const r2 = await forgotPassword(fd2)

    expect((r1 as { success?: string }).success).toBe((r2 as { success?: string }).success)
  })
})
