/**
 * Shared constants for the middleware chain.
 * Extracted from the monolithic updateSession() to avoid duplication.
 */

// ── Session timeout constants ────────────────────────────────────────────────
export const INACTIVITY_LIMIT_MS  = 30 * 60 * 1000        // 30 minutes
export const MAX_SESSION_MS       = 12 * 60 * 60 * 1000   // 12 hours

// ── Cookie names ─────────────────────────────────────────────────────────────
export const ACTIVITY_COOKIE      = 'cronix_last_activity'
export const SESSION_START_COOKIE = 'cronix_session_start'
export const STATUS_CACHE_COOKIE  = 'cronix_user_status'
export const STATUS_CACHE_TTL_S   = 5 * 60                 // 5 minutes

// ── Rate limit settings ──────────────────────────────────────────────────────
export const AUTH_RATE_LIMIT_MS   = 60 * 1000              // 1 minute window
export const MAX_AUTH_ATTEMPTS    = 5                       // 5 attempts/min
export const API_RATE_LIMIT_MS    = 60 * 1000              // 1 minute window
export const MAX_API_REQUESTS     = 60                      // 60 requests/min
