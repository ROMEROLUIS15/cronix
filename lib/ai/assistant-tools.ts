/**
 * assistant-tools.ts — Facade re-export.
 *
 * The original 756-line God File has been decomposed into:
 *  - lib/ai/tools/appointment.tools.ts  (appointment read/write)
 *  - lib/ai/tools/client.tools.ts       (client read/write)
 *  - lib/ai/tools/finance.tools.ts      (finance read/write)
 *  - lib/ai/tools/crm.tools.ts          (staff, services, WhatsApp)
 *  - lib/ai/tools/_context.ts           (ToolContext factory)
 *  - lib/ai/tools/_helpers.ts           (shared utilities)
 *
 * This file exists for backward compatibility — all consumers importing
 * from './assistant-tools' continue to work without changes.
 *
 * @deprecated Import directly from './tools' in new code.
 */

export {
  get_appointments_by_date,
  get_upcoming_gaps,
  cancel_appointment,
  book_appointment,
  reschedule_appointment,
  get_monthly_forecast,
} from './tools/appointment.tools'

export {
  get_client_debt,
  get_client_appointments,
  get_clients,
  get_inactive_clients,
  create_client,
} from './tools/client.tools'

export {
  get_today_summary,
  register_payment,
  get_revenue_stats,
} from './tools/finance.tools'

export {
  get_services,
  get_staff,
  send_reactivation_message,
} from './tools/crm.tools'
