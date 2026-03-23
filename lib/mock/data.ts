// lib/mock/data.ts
import type {
  Appointment, Client, Service, User, Business,
  Transaction, Expense, DashboardStats, FinanceSummary,
} from '@/types'

export const BUSINESS_ID = 'biz-001'
export const USER_ID = 'usr-001'
const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86400000).toISOString()
const tomorrow = new Date(Date.now() + 86400000).toISOString()

export const mockBusiness: Business = {
  id: BUSINESS_ID,
  owner_id: USER_ID,
  name: 'Barbería Agendo Premium',
  slug: 'agendo-premium',
  category: 'Barbería',
  phone: '+57 300 123 4567',
  address: 'Calle 100 #15-20, Bogotá',
  logo_url: null,
  locale: 'es-CO',
  timezone: 'America/Bogota',
  plan: 'pro',
  settings: {
    notifications: {
      whatsapp: true,
      email: true,
      reminderHours: [24, 2]
    },
    workingHours: {
      monday: ['09:00', '19:00'],
      tuesday: ['09:00', '19:00'],
      wednesday: ['09:00', '19:00'],
      thursday: ['09:00', '19:00'],
      friday: ['09:00', '20:00'],
      saturday: ['08:00', '20:00'],
      sunday: null
    },
    maxDailyBookingsPerClient: 2
  },
  created_at: yesterday,
  updated_at: now
}

export const mockUsers: User[] = [
  {
    id: USER_ID,
    business_id: BUSINESS_ID,
    name: 'Luis Romero',
    email: 'luis@agendo.app',
    role: 'owner',
    avatar_url: null,
    color: '#7c3aed',
    phone: null,
    is_active: true,
    status: 'active',
    provider: 'email',
    created_at: yesterday,
    updated_at: now
  },
  {
    id: 'usr-002',
    business_id: BUSINESS_ID,
    name: 'Carlos Barbero',
    email: 'carlos@agendo.app',
    role: 'employee',
    avatar_url: null,
    color: '#2563eb',
    phone: null,
    is_active: true,
    status: 'active',
    provider: 'email',
    created_at: yesterday,
    updated_at: now
  }
]

export const mockServices: Service[] = [
  {
    id: 'ser-001',
    business_id: BUSINESS_ID,
    name: 'Corte de Cabello',
    description: 'Corte clásico con tijera y máquina',
    price: 35000,
    duration_min: 45,
    category: 'Cortes',
    color: '#7c3aed',
    is_active: true,
    created_at: yesterday,
    updated_at: now
  },
  {
    id: 'ser-002',
    business_id: BUSINESS_ID,
    name: 'Barba Ritual',
    description: 'Afeitado tradicional con toalla caliente',
    price: 25000,
    duration_min: 30,
    category: 'Barba',
    color: '#2563eb',
    is_active: true,
    created_at: yesterday,
    updated_at: now
  },
  {
    id: 'ser-003',
    business_id: BUSINESS_ID,
    name: 'Combo Master',
    description: 'Corte + Barba + Masaje capilar',
    price: 55000,
    duration_min: 75,
    category: 'Combos',
    color: '#059669',
    is_active: true,
    created_at: yesterday,
    updated_at: now
  }
]

export const mockClients: Client[] = [
  {
    id: 'cli-001',
    business_id: BUSINESS_ID,
    name: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+57 321 000 0001',
    avatar_url: null,
    notes: 'Cliente frecuente, prefiere corte bajo.',
    birthday: '1990-05-15',
    last_visit_at: yesterday,
    total_appointments: 12,
    total_spent: 420000,
    tags: ['VIP', 'Fiel'],
    created_at: yesterday,
    updated_at: now,
    deleted_at: null
  },
  {
    id: 'cli-002',
    business_id: BUSINESS_ID,
    name: 'Andrés García',
    email: 'andres@example.com',
    phone: '+57 321 000 0002',
    avatar_url: null,
    notes: null,
    birthday: null,
    last_visit_at: yesterday,
    total_appointments: 3,
    total_spent: 105000,
    tags: ['Nuevo'],
    created_at: yesterday,
    updated_at: now,
    deleted_at: null
  }
]

export const mockAppointments: Appointment[] = [
  {
    id: 'apt-001',
    business_id: BUSINESS_ID,
    client_id: 'cli-001',
    service_id: 'ser-001',
    assigned_user_id: USER_ID,
    start_at: new Date(new Date().setHours(9, 0, 0, 0)).toISOString(),
    end_at: new Date(new Date().setHours(9, 45, 0, 0)).toISOString(),
    status: 'completed',
    notes: 'Solicitó corte con tijera',
    is_dual_booking: false,
    cancel_reason: null,
    cancelled_at: null,
    created_at: yesterday,
    updated_at: now,
    client: {
      id: 'cli-001',
      name: 'Juan Pérez',
      phone: '+57 321 000 0001',
      avatar_url: null
    },
    service: {
      id: 'ser-001',
      name: 'Corte de Cabello',
      color: '#7c3aed',
      duration_min: 45,
      price: 35000
    },
    assigned_user: {
      id: USER_ID,
      name: 'Luis Romero',
      avatar_url: null,
      color: '#7c3aed'
    }
  },
  {
    id: 'apt-002',
    business_id: BUSINESS_ID,
    client_id: 'cli-002',
    service_id: 'ser-002',
    assigned_user_id: USER_ID,
    start_at: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(),
    end_at: new Date(new Date().setHours(11, 30, 0, 0)).toISOString(),
    status: 'pending',
    notes: null,
    is_dual_booking: false,
    cancel_reason: null,
    cancelled_at: null,
    created_at: yesterday,
    updated_at: now,
    client: {
      id: 'cli-002',
      name: 'Andrés García',
      phone: '+57 321 000 0002',
      avatar_url: null
    },
    service: {
      id: 'ser-002',
      name: 'Barba Ritual',
      color: '#2563eb',
      duration_min: 30,
      price: 25000
    },
    assigned_user: {
      id: USER_ID,
      name: 'Luis Romero',
      avatar_url: null,
      color: '#7c3aed'
    }
  }
]

export const mockExpenses: Expense[] = [
  {
    id: 'exp-001',
    business_id: BUSINESS_ID,
    category: 'supplies',
    amount: 150000,
    description: 'Insumos de barbería y limpieza',
    expense_date: now,
    created_at: now,
    created_by: USER_ID,
    receipt_url: null
  },
  {
    id: 'exp-002',
    business_id: BUSINESS_ID,
    category: 'rent',
    amount: 1200000,
    description: 'Arriendo local mensual',
    expense_date: yesterday,
    created_at: yesterday,
    created_by: USER_ID,
    receipt_url: null
  }
]

export const mockTransactions: Transaction[] = [
  {
    id: 'tra-001',
    business_id: BUSINESS_ID,
    appointment_id: 'apt-001',
    amount: 35000,
    net_amount: 35000,
    discount: 0,
    tip: 5000,
    method: 'cash',
    notes: 'Pago en efectivo',
    paid_at: now,
    created_at: now
  }
]

export const mockDashboardStats: DashboardStats = {
  appointmentsToday: 8,
  pendingAppointments: 3,
  completedToday: 5,
  totalClients: 156,
  revenueThisMonth: 4250000,
  appointmentsThisWeek: 28
}

export const mockFinanceSummary: FinanceSummary = {
  totalRevenue: 4250000,
  totalExpenses: 1350000,
  netProfit: 2900000,
  pendingPayments: 120000,
  transactionCount: 84
}
