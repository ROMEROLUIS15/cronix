/**
 * success-data.ts — Maps the booking adapter's success result (camelCase) to the
 * snake_case fields that renderBookingSuccessTemplate (via final-response.ts) reads.
 *
 * Pure, no I/O, no Deno globals — so it loads under both the Deno Edge runtime
 * (tool-executor.ts) and the Node/vitest test runner. This is the seam that the
 * original blank-confirmation bug slipped through: the adapter never carried
 * service/date/time, so the final-pass template rendered "Tu cita para ** quedó
 * agendada". The contract now lives in one testable place.
 *
 * reschedule reads new_date/new_time; confirm and cancel read date/time.
 */

export interface AdapterSuccessFields {
  serviceName?: string
  date?:        string
  time?:        string
}

export function buildSuccessTemplateData(
  toolName: string,
  r:        AdapterSuccessFields,
): Record<string, string | undefined> {
  return toolName === 'reschedule_booking'
    ? { service_name: r.serviceName, new_date: r.date, new_time: r.time }
    : { service_name: r.serviceName, date: r.date, time: r.time }
}
