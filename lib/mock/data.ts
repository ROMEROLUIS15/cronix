// Mock data for development — no database required
import type {
  Appointment, Client, Service, User, Business,
  Transaction, Expense, DashboardStats, FinanceSummary,
} from '@/types'

const BUSINESS_ID = 'biz-001'
const USER_ID = 'usr-001'

export const mockBusiness: Business = {
  id: BUSINESS_ID,
  owner_id: USER_ID,
  name: 'Barber Elite',
  slug: 'barber-elite',
  category: 'Barbería',
  phone: '+573001234567',
  address: 'Calle 72 # 10-15, Bogotá',
  plan: 'pro',
  timezone: 'America/Bogota',
  locale: 'es',
  settings: {
    notifications: { whatsapp: true, email: true, reminderHours: [24, 2] },
    workingHours: {
      mon: ['09:00', '18:00'], tue: ['09:00', '18:00'],
      wed: ['09:00', '18:00'], thu: ['09:00', '18:00'],
      fri: ['09:00', '18:00'], sat: ['09:00', '14:00'], sun: null,
    },
    maxDailyBookingsPerClient: 2,
  },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

export const mockUsers: User[] = [
  {
    id: USER_ID,
    business_id: BUSINESS_ID,
    role: 'owner',
    name: 'Carlos Martínez',
    phone: '+573001234567',
    color: '#EA580C',
    isActive: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'usr-002',
    business_id: BUSINESS_ID,
    role: 'employee',
    name: 'Andrés López',
    phone: '+573009874321',
    color: '#3B82F6',
    isActive: true,
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
  },
]

export const mockServices: Service[] = [
  { id: 'svc-001', business_id: BUSINESS_ID, name: 'Corte clásico',      duration_min: 30, price: 25000, color: '#EA580C', isActive: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  { id: 'svc-002', business_id: BUSINESS_ID, name: 'Corte + Barba',      duration_min: 45, price: 38000, color: '#C2410C', isActive: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  { id: 'svc-003', business_id: BUSINESS_ID, name: 'Coloración',         duration_min: 90, price: 80000, color: '#F97316', isActive: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  { id: 'svc-004', business_id: BUSINESS_ID, name: 'Afeitado clásico',   duration_min: 30, price: 20000, color: '#FB923C', isActive: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  { id: 'svc-005', business_id: BUSINESS_ID, name: 'Tratamiento capilar', duration_min: 60, price: 55000, color: '#7C2D12', isActive: true, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
]

export const mockClients: Client[] = [
  {
    id: 'cli-001', business_id: BUSINESS_ID, name: 'Juan Pérez',
    phone: '+573001111111', email: 'juan@mail.com', tags: ['VIP', 'frecuente'],
    total_appointments: 24, total_spent: 720000,
    last_visit_at: '2024-03-01T14:00:00Z',
    created_at: '2024-01-05T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'cli-002', business_id: BUSINESS_ID, name: 'Luis García',
    phone: '+573002222222', tags: [],
    total_appointments: 8, total_spent: 290000,
    last_visit_at: '2024-02-25T11:00:00Z',
    created_at: '2024-01-20T00:00:00Z', updated_at: '2024-02-25T00:00:00Z',
  },
  {
    id: 'cli-003', business_id: BUSINESS_ID, name: 'Alejandro Torres',
    phone: '+573003333333', email: 'ale@mail.com', tags: ['nuevo'],
    total_appointments: 3, total_spent: 90000,
    last_visit_at: '2024-03-02T16:00:00Z',
    created_at: '2024-02-10T00:00:00Z', updated_at: '2024-03-02T00:00:00Z',
  },
  {
    id: 'cli-004', business_id: BUSINESS_ID, name: 'Sebastián Ruiz',
    phone: '+573004444444', tags: ['VIP'],
    total_appointments: 15, total_spent: 540000,
    last_visit_at: '2024-03-03T10:00:00Z',
    created_at: '2024-01-10T00:00:00Z', updated_at: '2024-03-03T00:00:00Z',
  },
  {
    id: 'cli-005', business_id: BUSINESS_ID, name: 'Miguel Hernández',
    phone: '+573005555555', tags: [],
    total_appointments: 6, total_spent: 188000,
    last_visit_at: '2024-02-20T09:00:00Z',
    created_at: '2024-01-25T00:00:00Z', updated_at: '2024-02-20T00:00:00Z',
  },
]

// Today's appointments
const today = new Date()
const todayStr = today.toISOString().split('T')[0]

export const mockAppointments: Appointment[] = [
  {
    id: 'apt-001', business_id: BUSINESS_ID,
    client_id: 'cli-001',
    client: { id: 'cli-001', name: 'Juan Pérez', phone: '+573001111111' },
    service_id: 'svc-002',
    service: { id: 'svc-002', name: 'Corte + Barba', color: '#C2410C', duration_min: 45, price: 38000 },
    assigned_user: { id: USER_ID, name: 'Carlos Martínez', color: '#EA580C' },
    start_at: `${todayStr}T09:00:00Z`, end_at: `${todayStr}T09:45:00Z`,
    status: 'confirmed', is_dual_booking: false,
    created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'apt-002', business_id: BUSINESS_ID,
    client_id: 'cli-002',
    client: { id: 'cli-002', name: 'Luis García', phone: '+573002222222' },
    service_id: 'svc-001',
    service: { id: 'svc-001', name: 'Corte clásico', color: '#EA580C', duration_min: 30, price: 25000 },
    assigned_user: { id: 'usr-002', name: 'Andrés López', color: '#3B82F6' },
    start_at: `${todayStr}T10:00:00Z`, end_at: `${todayStr}T10:30:00Z`,
    status: 'pending', is_dual_booking: false,
    created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'apt-003', business_id: BUSINESS_ID,
    client_id: 'cli-004',
    client: { id: 'cli-004', name: 'Sebastián Ruiz', phone: '+573004444444' },
    service_id: 'svc-003',
    service: { id: 'svc-003', name: 'Coloración', color: '#F97316', duration_min: 90, price: 80000 },
    assigned_user: { id: USER_ID, name: 'Carlos Martínez', color: '#EA580C' },
    start_at: `${todayStr}T11:00:00Z`, end_at: `${todayStr}T12:30:00Z`,
    status: 'confirmed', is_dual_booking: false,
    created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'apt-004', business_id: BUSINESS_ID,
    client_id: 'cli-001',
    client: { id: 'cli-001', name: 'Juan Pérez', phone: '+573001111111' },
    service_id: 'svc-005',
    service: { id: 'svc-005', name: 'Tratamiento capilar', color: '#7C2D12', duration_min: 60, price: 55000 },
    assigned_user: { id: USER_ID, name: 'Carlos Martínez', color: '#EA580C' },
    start_at: `${todayStr}T15:00:00Z`, end_at: `${todayStr}T16:00:00Z`,
    status: 'pending', is_dual_booking: true, // ⭐ Juan tiene doble cita hoy
    created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'apt-005', business_id: BUSINESS_ID,
    client_id: 'cli-003',
    client: { id: 'cli-003', name: 'Alejandro Torres', phone: '+573003333333' },
    service_id: 'svc-004',
    service: { id: 'svc-004', name: 'Afeitado clásico', color: '#FB923C', duration_min: 30, price: 20000 },
    assigned_user: { id: 'usr-002', name: 'Andrés López', color: '#3B82F6' },
    start_at: `${todayStr}T14:00:00Z`, end_at: `${todayStr}T14:30:00Z`,
    status: 'completed', is_dual_booking: false,
    created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z',
  },
]

export const mockTransactions: Transaction[] = [
  { id: 'txn-001', business_id: BUSINESS_ID, appointment_id: 'apt-005', amount: 20000, discount: 0, tip: 5000, net_amount: 25000, method: 'cash', paid_at: `${todayStr}T14:35:00Z`, created_at: `${todayStr}T14:35:00Z` },
  { id: 'txn-002', business_id: BUSINESS_ID, appointment_id: 'apt-003', amount: 80000, discount: 10, tip: 0, net_amount: 72000, method: 'card', paid_at: `${todayStr}T12:35:00Z`, created_at: `${todayStr}T12:35:00Z` },
]

export const mockExpenses: Expense[] = [
  { id: 'exp-001', business_id: BUSINESS_ID, category: 'supplies', amount: 85000, description: 'Insumos mensuales (gel, cera, etc)', expense_date: todayStr, created_at: `${todayStr}T08:00:00Z` },
  { id: 'exp-002', business_id: BUSINESS_ID, category: 'rent', amount: 1200000, description: 'Arriendo local', expense_date: todayStr, created_at: `${todayStr}T08:00:00Z` },
]

export const mockDashboardStats: DashboardStats = {
  appointmentsToday: 5,
  appointmentsThisWeek: 32,
  totalClients: 87,
  revenueThisMonth: 4250000,
  pendingAppointments: 2,
  completedToday: 1,
}

export const mockFinanceSummary: FinanceSummary = {
  totalRevenue:     4250000,
  totalExpenses:    1850000,
  netProfit:        2400000,
  pendingPayments:  156000,
  transactionCount: 87,
}
