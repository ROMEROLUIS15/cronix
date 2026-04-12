/**
 * Shared types for the dashboard.
 * Kept as a thin barrel — the actual hook lives in _client/dashboard-client.tsx.
 */

export interface DashboardStats {
  todayCount:    number
  totalClients:  number
  monthRevenue:  number
  pending:       number
}
