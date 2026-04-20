/**
 * Guards — rate limiting, circuit breaker, and token quota.
 * All functions fail-open on DB error to avoid blocking legitimate users.
 */

import { supabase } from "./db-client.ts"

// ── Message rate limiting ─────────────────────────────────────────────────────

/** Returns true if the sender is within the allowed message rate (10 msgs / 60s). */
export async function checkMessageRateLimit(senderPhone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_rate_limit', {
    p_sender:      senderPhone,
    p_window_secs: 60,
    p_max_msgs:    10,
  })
  if (error) return true  // fail-open
  return data as boolean
}

/** Returns true if the client has fewer than 5 upcoming active appointments at this business. */
export async function checkBookingRateLimit(
  senderPhone: string,
  businessId:  string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_booking_limit', {
    p_sender:       senderPhone,
    p_business_id:  businessId,
    p_window_secs:  86400,
    p_max_bookings: 5,
  })
  if (error) return true  // fail-open
  return data as boolean
}

/** Returns true if the business is within its aggregate message quota (50 msgs / 60s). */
export async function checkBusinessUsageLimit(businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_business_limit', {
    p_business_id: businessId,
    p_window_secs: 60,
    p_max_msgs:    50,
  })
  if (error) return true  // fail-open
  return data as boolean
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

/** Returns true if the service is allowed to be called (circuit is CLOSED). */
export async function checkCircuitBreaker(serviceName: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_circuit_breaker', {
    p_service_name: serviceName,
    p_reset_mins:   2,
  })
  if (error) return true  // fail-open
  return data as boolean
}

export async function reportServiceFailure(serviceName: string): Promise<void> {
  await supabase.rpc('fn_wa_report_service_failure', {
    p_service_name: serviceName,
    p_threshold:    3,
  })
}

export async function reportServiceSuccess(serviceName: string): Promise<void> {
  await supabase.rpc('fn_wa_report_service_success', {
    p_service_name: serviceName,
  })
}

// ── Token quota (cost control) ────────────────────────────────────────────────

/** Returns true if the business is within its daily token quota. */
export async function checkTokenQuota(businessId: string, dailyLimit: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('fn_wa_check_token_quota', {
    p_business_id: businessId,
    p_daily_limit: dailyLimit,
  })
  if (error) return true  // fail-open
  return data as boolean
}

export async function trackTokenUsage(businessId: string, tokens: number): Promise<void> {
  await supabase.rpc('fn_wa_track_token_usage', {
    p_business_id: businessId,
    p_tokens:      tokens,
  })
}
