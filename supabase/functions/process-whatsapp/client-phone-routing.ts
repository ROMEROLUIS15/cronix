/**
 * client-phone-routing.ts — Tier-3 tenant decision (pure). It lives in
 * `_shared/wa-tenant-routing.ts` since WhatsApp calls (phone-agent-api) route by the same
 * rule; re-exported here so the message side keeps its names.
 */

export {
  type ClientPhoneMatch, type UpcomingAppointment,
  distinctBusinessIds, pickBusinessForClientPhone,
} from "../_shared/wa-tenant-routing.ts"
