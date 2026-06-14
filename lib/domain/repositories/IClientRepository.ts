/**
 * IClientRepository — Domain contract for client persistence.
 *
 * Exposes: all client read/write operations needed by the system.
 * Does not expose: Supabase, HTTP, or infrastructure details.
 * Guarantees: every method returns Result<T> — never throws.
 */

import type { Result } from '@/types/result'
import type { Client, ClientAppointmentWithDetails } from '@/types'

export type ClientForSelect = {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export type ClientForAI = {
  id: string
  name: string
  phone: string | null
}

/**
 * Reengageable client candidate (retention module).
 * Returned by the deterministic RPC: past 'completed' visit beyond frequency,
 * no active future appointment, outside anti-spam window, has a phone.
 */
export type EligibleClientRow = {
  id: string
  name: string
  phone: string
  lastVisitAt: string | null
  lastCompletedAt: string | null
}

export type InsertClientPayload = {
  business_id: string
  name: string
  phone: string
  email?: string
}

export interface IClientRepository {
  /**
   * Returns all active clients for a business, ordered by name.
   */
  getAll(businessId: string): Promise<Result<Client[]>>

  /**
   * Returns minimal client data for form dropdowns.
   */
  getAllForSelect(businessId: string): Promise<Result<ClientForSelect[]>>

  /**
   * Returns a single client by ID with business isolation.
   */
  getById(clientId: string, businessId: string): Promise<Result<Client | null>>

  /**
   * Returns client appointments with service + transaction details.
   */
  getAppointments(
    clientId: string,
    businessId: string
  ): Promise<Result<ClientAppointmentWithDetails[]>>

  /**
   * Returns minimal client rows for AI fuzzy-name matching.
   */
  findActiveForAI(businessId: string): Promise<Result<ClientForAI[]>>

  /**
   * Inserts a new client and returns the created row.
   */
  insert(payload: InsertClientPayload): Promise<Result<ClientForAI>>

  /**
   * Returns inactive clients (no visit in 60 days) via RPC.
   * @deprecated Superseded by findInactiveByFrequency (retention v1). No callers.
   */
  findInactive(
    businessId: string,
    sixtyDaysAgo: string
  ): Promise<Result<{ name: string }[]>>

  /**
   * Returns clients eligible for re-engagement (retention v1): a past 'completed'
   * visit beyond `frequencyDays`, no active future appointment, outside the
   * `antiSpamDays` window, with a phone. Deterministic (SQL RPC), no LLM.
   */
  findInactiveByFrequency(
    businessId: string,
    frequencyDays: number,
    antiSpamDays: number
  ): Promise<Result<EligibleClientRow[]>>

  /**
   * Stamps the last re-engagement time (anti-spam guard) and invalidates the
   * client cache. Scoped to businessId.
   */
  updateLastReengaged(
    clientId: string,
    businessId: string
  ): Promise<Result<void>>

  /**
   * Permanently opts a client out of re-engagement (STOP). Matched by phone
   * within the business. Idempotent — a non-matching phone is a no-op. Invalidates
   * the client cache. (modulo-retencion §8)
   */
  setRetentionOptOut(
    clientPhone: string,
    businessId: string
  ): Promise<Result<void>>

  /**
   * Soft-deletes a client by setting deleted_at. Scoped to businessId.
   */
  softDelete(clientId: string, businessId: string): Promise<Result<void>>
}
