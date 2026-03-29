/**
 * Query Response Types — Typed interfaces for Supabase JOIN queries.
 *
 * These types represent the actual shape of data returned by Supabase
 * when using `.select('... , relation:table(fields)')` JOINs.
 *
 * Why: Supabase's auto-generated types don't resolve JOINs correctly,
 * forcing `as any` casts throughout pages. By defining explicit interfaces
 * for each query pattern, we eliminate all runtime casts.
 *
 * Guarantees:
 *  - Each type matches exactly one `.select()` pattern used in the app
 *  - All `as any` casts on Supabase join results can be replaced
 *
 * Does NOT guarantee:
 *  - Automatic sync with the database schema (still rely on database.types.ts)
 */

import type { AppointmentStatus, PaymentMethod, ExpenseCategory } from '.'

// ── Relations used in appointment queries ──────────────────────────────────

export interface AppointmentClient {
  id: string
  name: string
  phone: string | null
  avatar_url: string | null
}

export interface AppointmentService {
  id: string
  name: string
  color: string | null
  duration_min: number
  price: number
}

export interface AppointmentAssignedUser {
  id: string
  name: string
  avatar_url?: string | null
  color?: string | null
}

// ── Appointment with Relations (Dashboard calendar, agenda) ────────────────

export interface AppointmentServiceJunction {
  sort_order: number
  service: AppointmentService
}

export interface AppointmentWithRelations {
  id: string
  start_at: string
  end_at: string
  status: AppointmentStatus | null
  is_dual_booking: boolean | null
  notes: string | null
  client: AppointmentClient | null
  service: AppointmentService | null
  appointment_services?: AppointmentServiceJunction[]
  assigned_user: AppointmentAssignedUser | null
}

// ── Client appointment with service + transactions (Client detail page) ────

export interface TransactionSummary {
  net_amount: number
  amount: number
}

export interface ClientAppointmentWithDetails {
  id: string
  start_at: string
  end_at: string
  status: AppointmentStatus | null
  is_dual_booking: boolean | null
  notes: string | null
  client_id: string
  service: AppointmentService | null
  appointment_services?: AppointmentServiceJunction[]
  transactions: TransactionSummary[]
}

// ── Expense row (typed from database) ──────────────────────────────────────

export interface ExpenseRow {
  id: string
  business_id: string
  category: ExpenseCategory
  amount: number
  description: string | null
  expense_date: string
  created_at: string | null
  created_by: string | null
  receipt_url: string | null
}

// ── Transaction row for listing ────────────────────────────────────────────

export interface TransactionRow {
  id: string
  business_id: string
  appointment_id: string | null
  amount: number
  net_amount: number
  discount: number | null
  tip: number | null
  method: PaymentMethod
  notes: string | null
  paid_at: string | null
  created_at: string | null
}

// ── Slot check (used in validation queries, no JOINs) ──────────────────────

export interface SlotCheckAppointment {
  id: string
  start_at: string
  end_at: string
  client_id: string
  assigned_user_id: string | null
}

// ── Business settings typed wrapper ────────────────────────────────────────

export interface BusinessSettingsJson {
  workingHours?: Record<string, [string, string] | null>
  notifications?: {
    whatsapp: boolean
    email: boolean
    reminderHours?: number[]  // legacy
  }
  maxDailyBookingsPerClient?: number
}
