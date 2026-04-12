/**
 * Repository Test Mocks — Utilities for mocking Supabase in unit tests.
 */

import { vi } from 'vitest'
import { mockDeep, MockProxy } from 'vitest-mock-extended'
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

export type SupabaseMock = MockProxy<SupabaseClient<Database>>

/**
 * Creates a deep mock of the Supabase Client.
 */
export function createSupabaseMock() {
  return mockDeep<SupabaseClient<Database>>()
}

/**
 * Helper to mock a chainable Supabase query response.
 * It returns an object that mirrors the Supabase query builder and is awaitable.
 */
export function mockSupabaseResponse<T>(data: T | null = null, error: any = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error, count: (Array.isArray(data) ? data.length : (data ? 1 : 0)) }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error, count: (Array.isArray(data) ? data.length : (data ? 1 : 0)) }),
    // To support being 'await'ed directly (e.g., const { data } = await query)
    then: (onfulfilled?: any) => Promise.resolve({ data, error, count: (Array.isArray(data) ? data.length : (data ? 1 : 0)) }).then(onfulfilled),
    catch: (onrejected?: any) => Promise.resolve({ data, error }).catch(onrejected),
    finally: (onfinally?: any) => Promise.resolve({ data, error }).finally(onfinally),
  }

  return chain as any
}
