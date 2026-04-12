/**
 * lib/ai/tools/index.ts — Barrel export for all AI tool modules.
 *
 * Exposes: all tool functions + ToolContext factory.
 * Does not expose: helpers or internal utilities (_context, _helpers).
 */

export { buildToolContext } from './_context'
export type { ToolContext } from './_context'

export {
  get_upcoming_gaps,
  cancel_appointment,
  book_appointment,
  reschedule_appointment,
  get_monthly_forecast,
} from './appointment.tools'

export {
  get_client_debt,
  get_client_appointments,
  get_clients,
  get_inactive_clients,
  create_client,
} from './client.tools'

export {
  get_today_summary,
  register_payment,
  get_revenue_stats,
} from './finance.tools'

export {
  get_services,
  get_staff,
  send_reactivation_message,
} from './crm.tools'
