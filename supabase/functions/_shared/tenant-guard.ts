/**
 * TenantGuard — Multi-tenant isolation validator for Edge Functions.
 * 
 * Since Edge Functions use SUPABASE_SERVICE_ROLE_KEY (bypassing RLS),
 * this guard provides defense-in-depth by verifying resource ownership
 * before any mutation operation.
 * 
 * Usage:
 *   const guard = new TenantGuard(businessId)
 *   if (!await guard.verifyAppointmentOwnership(appointmentId)) {
 *     throw new Error('Access denied')
 *   }
 */

import { supabase } from "./supabase.ts"

export class TenantGuard {
  constructor(private businessId: string) {}

  /**
   * Verify an appointment belongs to this business.
   * Returns the appointment data if valid, null otherwise.
   */
  async verifyAppointmentOwnership(appointmentId: string): Promise<{
    id: string
    business_id: string
    client_id: string
    status: string
    start_at: string
    end_at: string
  } | null> {
    const { data, error } = await supabase
      .from("appointments")
      .select("id, business_id, client_id, status, start_at, end_at")
      .eq("id", appointmentId)
      .eq("business_id", this.businessId)
      .single()

    if (error || !data) return null
    return data as {
      id: string
      business_id: string
      client_id: string
      status: string
      start_at: string
      end_at: string
    }
  }

  /**
   * Verify a client belongs to this business.
   * Returns the client data if valid, null otherwise.
   */
  async verifyClientOwnership(clientId: string): Promise<{
    id: string
    business_id: string
    name: string
    phone: string
  } | null> {
    const { data, error } = await supabase
      .from("clients")
      .select("id, business_id, name, phone")
      .eq("id", clientId)
      .eq("business_id", this.businessId)
      .single()

    if (error || !data) return null
    return data as {
      id: string
      business_id: string
      name: string
      phone: string
    }
  }

  /**
   * Verify a service belongs to this business.
   * Returns the service data if valid, null otherwise.
   */
  async verifyServiceOwnership(serviceId: string): Promise<{
    id: string
    business_id: string
    name: string
    price: number
  } | null> {
    const { data, error } = await supabase
      .from("services")
      .select("id, business_id, name, price")
      .eq("id", serviceId)
      .eq("business_id", this.businessId)
      .single()

    if (error || !data) return null
    return data as {
      id: string
      business_id: string
      name: string
      price: number
    }
  }

  /**
   * Verify a user (staff member) belongs to this business.
   * Returns the user data if valid, null otherwise.
   */
  async verifyUserOwnership(userId: string): Promise<{
    id: string
    business_id: string
    name: string
    role: string
  } | null> {
    const { data, error } = await supabase
      .from("users")
      .select("id, business_id, name, role")
      .eq("id", userId)
      .eq("business_id", this.businessId)
      .single()

    if (error || !data) return null
    return data as {
      id: string
      business_id: string
      name: string
      role: string
    }
  }

  /**
   * Throw an error if the appointment doesn't belong to this business.
   * Convenience method that combines verify + error handling.
   */
  async enforceAppointmentAccess(appointmentId: string): Promise<{
    id: string
    business_id: string
    client_id: string
    status: string
    start_at: string
    end_at: string
  }> {
    const appointment = await this.verifyAppointmentOwnership(appointmentId)
    if (!appointment) {
      throw new Error(
        `TENANT_VIOLATION: Appointment ${appointmentId} does not belong to business ${this.businessId}`
      )
    }
    return appointment
  }

  /**
   * Throw an error if the client doesn't belong to this business.
   */
  async enforceClientAccess(clientId: string): Promise<{
    id: string
    business_id: string
    name: string
    phone: string
  }> {
    const client = await this.verifyClientOwnership(clientId)
    if (!client) {
      throw new Error(
        `TENANT_VIOLATION: Client ${clientId} does not belong to business ${this.businessId}`
      )
    }
    return client
  }
}
