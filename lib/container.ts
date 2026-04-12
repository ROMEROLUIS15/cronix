/**
 * lib/container.ts — Root Dependency Injection Container for Cronix.
 *
 * Purpose: decouple high-level modules (Server Actions, API routes, hooks)
 * from concrete Supabase implementations.
 *
 * When migrating to a custom backend, only this file changes — all consumers
 * continue to call container.appointments, container.clients, etc.
 *
 * Usage:
 *   const container = await getContainer()
 *   const result = await container.appointments.getDayAppointments(bizId, date)
 *
 * ── Request-Scoped Safety ───────────────────────────────────────────────────
 * In Next.js serverless, a single Node.js process handles concurrent requests.
 * The old module-level singleton was shared across requests — a race condition
 * where two requests could share the same Supabase client with stale cookies.
 *
 * Now we use AsyncLocalStorage to scope the container to each request,
 * preventing cross-request data leakage while keeping test injection working.
 */

import type {
  IAppointmentRepository,
  IClientRepository,
  IServiceRepository,
  IFinanceRepository,
  INotificationRepository,
  IUserRepository,
  IBusinessRepository,
  IReminderRepository,
} from '@/lib/domain/repositories'

/**
 * Abstract container interface — all consumers depend on THIS, not on Supabase.
 */
export interface AppContainer {
  appointments:  IAppointmentRepository
  clients:       IClientRepository
  services:      IServiceRepository
  finances:      IFinanceRepository
  notifications: INotificationRepository
  users:         IUserRepository
  businesses:    IBusinessRepository
  reminders:     IReminderRepository
}

/**
 * Creates a Supabase-backed container (current implementation).
 * When migrating to a custom backend, replace this factory.
 */
export async function createSupabaseContainer(): Promise<AppContainer> {
  const { createClient } = await import('@/lib/supabase/server')
  const { getRepos } = await import('@/lib/repositories')

  const supabase = await createClient()
  return getRepos(supabase)
}

// ── Request-scoped container registry ────────────────────────────────────────
// AsyncLocalStorage gives each async context (request) its own container.
// This prevents the race condition where concurrent requests share stale state.

import { AsyncLocalStorage } from 'async_hooks'

const _als = new AsyncLocalStorage<AppContainer>()

// Test container override (set via setTestContainer for mocking)
let _testContainer: AppContainer | null = null

/**
 * Returns the current application container.
 *
 * - If inside a `runWithContainer()` context, returns the request-scoped instance.
 * - If a test container is set, returns that (for testing).
 * - Otherwise, creates a fresh container for this async context.
 *
 * Safe for concurrent requests — each gets its own container.
 */
export async function getContainer(): Promise<AppContainer> {
  // Check for test override first
  if (_testContainer) return _testContainer

  // Check if we're inside a request-scoped context
  const existing = _als.getStore()
  if (existing) return existing

  // Fallback: create a fresh container for this async context
  // (This handles cases where getContainer is called outside the middleware wrapper)
  return createSupabaseContainer()
}

/**
 * Wraps a function call with a request-scoped container.
 * Use this in API routes and Server Actions to ensure all downstream
 * getContainer() calls see the same Supabase client with the correct cookies.
 *
 * Example:
 *   export async function POST(req: NextRequest) {
 *     return runWithContainer(async () => {
 *       const container = await getContainer()
 *       // ... use container safely
 *     })
 *   }
 */
export async function runWithContainer<T>(fn: () => Promise<T>): Promise<T> {
  const container = await createSupabaseContainer()
  return _als.run(container, fn)
}

/**
 * Resets the test container override.
 * Use between tests to swap mocks.
 */
export function resetContainer(): void {
  _testContainer = null
}

/**
 * Sets a custom container (for testing or future backend swap).
 */
export function setTestContainer(container: AppContainer): void {
  _testContainer = container
}
