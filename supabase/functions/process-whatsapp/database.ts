/**
 * @deprecated This file has been split into focused modules.
 * Update your imports to point to the correct module:
 *
 *   time-utils.ts      ← localTimeToUTC
 *   guards.ts          ← checkMessageRateLimit, checkBookingRateLimit,
 *                         checkBusinessUsageLimit, checkCircuitBreaker,
 *                         reportServiceFailure, reportServiceSuccess,
 *                         checkTokenQuota, trackTokenUsage
 *   business-router.ts ← getBusinessBySlug, getSessionBusiness, upsertSession,
 *                         getBusinessByPhone, verifyBusinessPhone
 *   context-fetcher.ts ← getBusinessServices, getClientByPhone, getActiveAppointments,
 *                         getConversationHistory, getBookedSlots, getAvailableSlots
 *   appointment-repo.ts← createAppointment, getAppointmentDetails,
 *                         rescheduleAppointment, cancelAppointmentById
 *   audit.ts           ← logInteraction, createInternalNotification
 */
