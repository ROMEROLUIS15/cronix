import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ pathname: '/dashboard', purge: vi.fn(async () => {}) }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/lib/pwa/signed-out-cache-purge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pwa/signed-out-cache-purge')>()),
  purgeSignedOutCaches: mocks.purge,
}))

const { SignedOutCachePurge } = await import('@/components/signed-out-cache-purge')

beforeEach(() => { mocks.purge.mockClear() })

describe('SignedOutCachePurge', () => {
  it('purges when an in-app navigation reaches a page without session, as sign-out does', () => {
    mocks.pathname = '/dashboard'
    const view = render(<SignedOutCachePurge />)
    expect(mocks.purge).not.toHaveBeenCalled()
    mocks.pathname = '/'
    view.rerender(<SignedOutCachePurge />)
    expect(mocks.purge).toHaveBeenCalledTimes(1)
  })

  it('purges on a full load of the sign-in screen', () => {
    mocks.pathname = '/login'
    render(<SignedOutCachePurge />)
    expect(mocks.purge).toHaveBeenCalledTimes(1)
  })
})
