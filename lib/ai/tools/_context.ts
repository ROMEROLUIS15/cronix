/**
 * ToolContext — Shared dependency container injected into all AI tools.
 *
 * Exposes: typed repositories + notification helper + tenant guard.
 * Does not expose: Supabase client directly (repos are the abstraction layer).
 * Guarantees: one shared client per request — no N connections per tool call.
 *
 * Usage:
 *   import { buildToolContext } from '@/lib/ai/tools/_context'
 *   const ctx = await buildToolContext()
 *   await book_appointment(args, ctx)
 */

import type {
  IAppointmentRepository,
  IClientRepository,
  IServiceRepository,
  IFinanceRepository,
  INotificationRepository,
  IUserRepository,
  IBusinessRepository,
} from '@/lib/domain/repositories'
import type { TenantGuard } from '@/lib/ai/with-tenant-guard'

// ── ToolContext contract ────────────────────────────────────────────────────

export type ToolContext = {
  appointmentRepo:  IAppointmentRepository
  clientRepo:       IClientRepository
  serviceRepo:      IServiceRepository
  financeRepo:      IFinanceRepository
  notificationRepo: INotificationRepository
  userRepo:         IUserRepository
  businessRepo:     IBusinessRepository
  tenantGuard:      TenantGuard
}

// ── Factory: builds context with one shared Supabase client per request ────

export async function buildToolContext(): Promise<ToolContext> {
  // Lazy imports to avoid bundling server-only code on the client
  const { createAdminClient } = await import('@/lib/supabase/server')
  const { getRepos } = await import('@/lib/repositories')
  const { createTenantGuard } = await import('@/lib/ai/with-tenant-guard')

  // SECURITY: Use admin client for repositories — RLS on `users` table causes
  // recursion when tools query clients/appointments (SELECT business_id FROM users WHERE id = auth.uid()).
  // Business isolation is enforced by tenantGuard.verify(business_id) inside each tool
  // BEFORE any repo call, so bypassing RLS here is safe.
  const adminClient = createAdminClient()
  const repos = getRepos(adminClient)
  const tenantGuard = await createTenantGuard()

  return {
    appointmentRepo:  repos.appointments,
    clientRepo:       repos.clients,
    serviceRepo:      repos.services,
    financeRepo:      repos.finances,
    notificationRepo: repos.notifications,
    userRepo:         repos.users,
    businessRepo:     repos.businesses,
    tenantGuard,
  }
}
