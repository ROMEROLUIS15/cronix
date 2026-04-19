import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/activity/ping/route'

describe('POST /api/activity/ping', () => {

  it('returns 200 with { ok: true }', async () => {
    const response = await POST()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ok: true })
  })

  it('is idempotent — repeated calls return same shape', async () => {
    const r1 = await POST()
    const r2 = await POST()

    expect(r1.status).toBe(r2.status)
    expect(await r1.json()).toEqual(await r2.json())
  })
})
