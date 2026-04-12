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
   */
  findInactive(
    businessId: string,
    sixtyDaysAgo: string
  ): Promise<Result<{ name: string }[]>>
}
