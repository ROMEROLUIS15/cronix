import { Database } from './database.types'

// ─────────────────────────────────────────────────────────────
// Domain Types — Agendo (Derived from Supabase)
// ─────────────────────────────────────────────────────────────

// ── Database Schema ──────────────────────────────────────────
export type Tables = Database['public']['Tables']
export type Enums = Database['public']['Enums']

// ── Enums ──────────────────────────────────────────────────
export type AppointmentStatus = Enums['appointment_status']
export type PaymentMethod = Enums['payment_method']
export type UserRole = Enums['user_role']
export type BusinessPlan = Enums['business_plan']
export type ExpenseCategory = Enums['expense_category']

// ── Core Entities (Rows) ───────────────────────────────────
export type User = Tables['users']['Row']
export type Business = Tables['businesses']['Row']
export type Client = Tables['clients']['Row']
export type Service = Tables['services']['Row']
export type Appointment = Tables['appointments']['Row'] & {
  client?: Pick<Client, 'id' | 'name' | 'phone' | 'avatar_url'>
  service?: Pick<Service, 'id' | 'name' | 'color' | 'duration_min' | 'price'>
  assigned_user?: Pick<User, 'id' | 'name' | 'avatar_url' | 'color'>
} // Extended for UI relations

export type Transaction = Tables['transactions']['Row']
export type Expense = Tables['expenses']['Row']

export interface BusinessSettings {
  notifications: {
    whatsapp: boolean
    email: boolean
    reminderHours?: number[]  // legacy — no longer used in UI; defaults to 24h
  }
  workingHours: Record<string, [string, string] | null>
  maxDailyBookingsPerClient: number
}

// ── DTOs (Insert/Update types) ──────────────────────────────
export type CreateAppointmentDTO = Tables['appointments']['Insert'] & { confirmDouble?: boolean }
export type UpdateAppointmentDTO = Tables['appointments']['Update']

export type CreateClientDTO = Tables['clients']['Insert']
export type UpdateClientDTO = Tables['clients']['Update']

export type CreateTransactionDTO = Tables['transactions']['Insert']
export type UpdateTransactionDTO = Tables['transactions']['Update']

// ── Paginated Result ────────────────────────────────────────
export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

// ── Double Booking ───────────────────────────────────────────
export type DoubleBookingLevel = 'allowed' | 'warn' | 'blocked'

export interface DoubleBookingCheckResult {
  level: DoubleBookingLevel
  existingCount: number
  existingSlots: Array<{ time: string; service: string }>
  message: string
}

// ── Finance Summary ──────────────────────────────────────────
export interface FinanceSummary {
  totalRevenue: number
  totalExpenses: number
  netProfit: number
  pendingPayments: number
  transactionCount: number
}

// ── Dashboard Stats ──────────────────────────────────────────
export interface DashboardStats {
  appointmentsToday: number
  appointmentsThisWeek: number
  totalClients: number
  revenueThisMonth: number
  pendingAppointments: number
  completedToday: number
}

// ── Query Response Types (Supabase JOINs) ───────────────────
export type {
  AppointmentWithRelations,
  AppointmentServiceJunction,
  AppointmentClient,
  AppointmentService,
  AppointmentAssignedUser,
  ClientAppointmentWithDetails,
  TransactionSummary,
  ExpenseRow,
  TransactionRow,
  SlotCheckAppointment,
  BusinessSettingsJson,
} from './query-types'
