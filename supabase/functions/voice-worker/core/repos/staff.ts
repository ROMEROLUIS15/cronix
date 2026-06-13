/**
 * Staff (team member) resolution for voice writes.
 *
 * Groundwork for the multi-employee sprint, with one product decision
 * already taken: a voice booking is assigned to the team member THE OWNER
 * NAMES ("con Marielys", "conmigo"). When nobody is named the appointment
 * stays unassigned (assigned_user_id = NULL) — the auto-assignment policy
 * for multi-staff businesses is deliberately NOT decided here.
 */

import type { ToolContext } from '../tool-context.ts'
import { fuzzyFind, normalize, tokens, WRITE_CONFIDENCE_THRESHOLD } from '../fuzzy.ts'

export interface StaffRow { id: string; name: string; role: string }

/**
 * Below this many assignable members, staff assignment is meaningless: a solo
 * owner has nobody to disambiguate against, so the agent must never offer it
 * or ask "¿con quién?". Gates BOTH the resolver paths AND (via context) the
 * prompt, so the LLM doesn't even learn staff exists on a one-person business.
 */
export const MIN_ASSIGNABLE_STAFF = 2

export async function getActiveStaff(ctx: ToolContext): Promise<StaffRow[]> {
  const { data, error } = await ctx.supabase
    .from('users')
    .select('id, name, role')
    .eq('business_id', ctx.businessId)
    .in('role', ['owner', 'admin', 'employee'])
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return data as StaffRow[]
}

export type StaffResolution =
  | { status: 'assigned'; staff: StaffRow }
  /** Couldn't bind the name safely — the tool must ask, never guess. */
  | { status: 'ask'; question: string }
  /** Business has no staff roster — proceed unassigned. */
  | { status: 'none' }

/**
 * Resolves an explicitly named team member with the same write-confidence
 * bar as clients (≥0.80). Assigning the wrong employee corrupts per-staff
 * agendas, so a weak or ambiguous match asks instead of guessing.
 */
export async function resolveStaffByName(ctx: ToolContext, name: string): Promise<StaffResolution> {
  const staff = await getActiveStaff(ctx)
  // Fewer than two assignable members → there is nothing to choose. Proceed
  // unassigned instead of asking; a named staff on a solo business is noise.
  if (staff.length < MIN_ASSIGNABLE_STAFF) return { status: 'none' }

  const found = fuzzyFind(staff, name)
  if (found.status === 'found' && (found.confidence ?? 0) >= WRITE_CONFIDENCE_THRESHOLD) {
    return { status: 'assigned', staff: found.match! }
  }
  if (found.status === 'found' || found.status === 'ambiguous') {
    const names = (found.candidates ?? []).map(c => c.name).join(', ')
    return { status: 'ask', question: `¿Con cuál miembro del equipo: ${names}?` }
  }
  return { status: 'ask', question: `No encontré a "${name}" en tu equipo. ¿Con quién agendo la cita?` }
}

const CON_TARGET = /\bcon\s+([a-z]+(?:\s+[a-z]+)?)/g

/**
 * Deterministic fallback when the LLM didn't pass staff_name (fast path, or
 * Llama dropped it): scans the corpus for "con <nombre>" / "conmigo" and
 * matches against the roster.
 *
 * Conservative by design:
 *   - "conmigo" → the speaking user, when they belong to the roster.
 *   - A "con X" candidate that token-overlaps the CLIENT being booked is
 *     ignored — "agenda una cita con Ana" names the client, not staff.
 *   - More than one distinct roster match → ignored (ambiguous).
 */
export async function extractStaffFromCorpus(
  ctx:        ToolContext,
  corpus:     string,
  clientName: string,
): Promise<StaffRow | null> {
  if (!corpus) return null
  const t = normalize(corpus)
  const wantsSpeaker = /\bconmigo\b/.test(t)
  const rawCandidates = [...t.matchAll(CON_TARGET)].map(m => m[1]!.trim())
  if (!wantsSpeaker && rawCandidates.length === 0) return null

  const staff = await getActiveStaff(ctx)
  // Same gate as resolveStaffByName: no disambiguation below the threshold.
  if (staff.length < MIN_ASSIGNABLE_STAFF) return null

  if (wantsSpeaker) {
    return staff.find(s => s.id === ctx.userId) ?? null
  }

  const clientTokens = new Set(tokens(clientName))
  const matched = new Map<string, StaffRow>()
  for (const cand of rawCandidates) {
    if (tokens(cand).some(ct => clientTokens.has(ct))) continue
    const found = fuzzyFind(staff, cand)
    if (found.status === 'found' && (found.confidence ?? 0) >= WRITE_CONFIDENCE_THRESHOLD) {
      matched.set(found.match!.id, found.match!)
    }
  }
  if (matched.size !== 1) return null
  return [...matched.values()][0]!
}
