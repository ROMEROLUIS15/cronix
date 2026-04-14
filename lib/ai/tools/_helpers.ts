/**
 * _helpers.ts — Shared utilities for all AI tools.
 *
 * Exposes: date formatting, notification fire helper.
 * Does not expose: Supabase client (notifications go through ToolContext).
 * Guarantees: no side-effects except fire-and-forget notifications.
 */

import { format, parseISO, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { logger } from '@/lib/logger'
import type { ToolContext } from './_context'

// ── Date utilities ──────────────────────────────────────────────────────────

/**
 * Converts a UTC ISO string to YYYY-MM-DD in the given IANA timezone.
 * Fixes off-by-one bugs when comparing dates stored in UTC.
 */
export function toLocalDateString(isoUtc: string, timezone: string): string {
  return new Date(isoUtc).toLocaleDateString('en-CA', { timeZone: timezone })
}

/**
 * Converts a UTC ISO string to a Date object adjusted to the local timezone.
 * Allows date-fns to format it correctly without needing timezone-aware format.
 */
export function toUserDate(isoString: string, timezone: string): Date {
  try {
    const utc   = new Date(isoString)
    const utcMs = new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    const tzMs  = new Date(utc.toLocaleString('en-US', { timeZone: timezone })).getTime()
    return new Date(utc.getTime() + (tzMs - utcMs))
  } catch {
    return new Date(isoString)
  }
}

/**
 * Formats a UTC ISO string in the user's local timezone using date-fns.
 */
export function fmtUserDate(isoString: string, timezone: string, fmt: string): string {
  return format(toUserDate(isoString, timezone), fmt, { locale: es })
}

/**
 * Returns true if the given date string contains a time component.
 */
export function hasTimeComponent(date: string): boolean {
  return date.includes('T') || date.includes(':') || /\d\s?(am|pm)/i.test(date)
}

/**
 * Calculates end time ISO string given a start ISO and duration in minutes.
 */
export function calcEndISO(startISO: string, durationMin: number): string {
  return new Date(new Date(startISO).getTime() + durationMin * 60_000).toISOString()
}

// ── Notification helper ─────────────────────────────────────────────────────

/**
 * Fire-and-forget: creates an in-app notification + web push.
 * Errors are logged but never thrown — never blocks tool execution.
 */
export async function fireToolNotification(
  ctx: ToolContext,
  business_id: string,
  title:       string,
  content:     string,
  type:        'success' | 'warning' | 'info' | 'error'
): Promise<void> {
  // In-app notification via repo
  const result = await ctx.notificationRepo.create({ business_id, title, content, type })
  if (result.error) {
    logger.error('TOOL-NOTIFY', 'createNotification failed', { business_id, error: result.error })
  }

  // Web Push via Edge Function (fire-and-forget)
  // Try CRON_SECRET first (server-side), fall back to dynamic import if needed
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const cronSecret  = process.env.CRON_SECRET
    
    if (supabaseUrl && cronSecret) {
      // Server-side: direct fetch to Edge Function
      fetch(`${supabaseUrl}/functions/v1/push-notify`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': cronSecret,
        },
        body: JSON.stringify({ business_id, title, body: content, url: '/dashboard' }),
      }).catch((err: unknown) => {
        logger.warn('TOOL-NOTIFY', 'push-notify fetch failed', {
          business_id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    } else {
      // Fallback: use notifyOwner service (client-side or missing secrets)
      const { notifyOwner } = await import('@/lib/services/push-notify.service')
      notifyOwner({
        title,
        body: content,
        url: '/dashboard',
      }).catch((err: Error) => {
        logger.warn('TOOL-NOTIFY', 'notifyOwner fallback failed', {
          business_id,
          error: err.message,
        })
      })
    }
  } catch (err) {
    logger.error('TOOL-NOTIFY', 'web push failed', {
      business_id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Speech formatting ───────────────────────────────────────────────────────

/**
 * Converts list-style tool output text into speech-friendly prose.
 *
 * TTS engines read literal characters — newlines become silent pauses
 * and bullet dashes ("- ") are sometimes vocalised as "guión".
 * This function collapses list items into comma/period-separated sentences
 * so the assistant sounds natural when read aloud.
 *
 * Example:
 *   "Citas:\n- 9:00 AM: María (Corte)\n- 10:30 AM: Juan (Depilación)"
 *   → "Citas: 9:00 AM: María (Corte). 10:30 AM: Juan (Depilación)."
 */
export function formatForSpeech(text: string): string {
  return text
    .replace(/\n[\s]*[-•]\s*/g, '. ')  // "\n- item" → ". item"
    .replace(/^[-•]\s*/gm,       '')   // leading bullet on first line → remove
    .replace(/\n+/g,            '. ')  // remaining newlines → sentence break
    .replace(/:\.\s*/g,         ': ') // ":." artefact → ": "
    .replace(/\.\s*\.\s*/g,     '. ') // double period → single
    .replace(/\s{2,}/g,          ' ') // collapse spaces
    .trim()
}

// ── Date guard ──────────────────────────────────────────────────────────────

/**
 * Returns an error string if the date is invalid or unreasonably old.
 * Returns null if date is valid and safe to use.
 */
export function validateApptDate(dateStr: string): string | null {
  const parsed = parseISO(dateStr)
  if (isNaN(parsed.getTime())) return 'La fecha proporcionada no es válida.'
  if (parsed < addDays(new Date(), -365)) return 'No puedo agendar citas con más de un año de antigüedad por seguridad.'
  return null
}
