/**
 * Types for cron-reminders Edge Function.
 */

export interface BusinessRow {
  id:       string
  name:     string
  timezone: string | null
  phone:    string | null
  settings: Record<string, unknown> | null
}

export interface AppointmentWithClient {
  id:         string
  start_at:   string
  service_id: string
  services:   { name: string } | null
  clients:    { name: string; phone: string | null } | null
}
