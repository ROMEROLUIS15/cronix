import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolContext } from '../tool-context.ts'
import { fuzzyFind, WRITE_CONFIDENCE_THRESHOLD } from '../fuzzy.ts'

export interface ClientRow { id: string; name: string; phone: string | null }

export async function getActiveClients(ctx: ToolContext): Promise<ClientRow[]> {
  const { data, error } = await ctx.supabase
    .from('clients')
    .select('id, name, phone')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
  if (error || !data) return []
  return data as ClientRow[]
}

export interface ResolveOk {
  status:      'found'
  client:      ClientRow
  /** Confidence in [0,1]; <0.80 means write-tools should ask the user. */
  confidence:  number
  /** Sibling candidates (≤5) including the matched one, for confirmation prompts. */
  candidates:  ClientRow[]
}
export interface ResolveAmb {
  status:      'ambiguous'
  candidates:  ClientRow[]
  confidence:  number
}
export interface ResolveMiss { status: 'not_found' }
export type    ResolveResult  = ResolveOk | ResolveAmb | ResolveMiss

export async function resolveClient(ctx: ToolContext, name: string): Promise<ResolveResult> {
  const all = await getActiveClients(ctx)
  if (!all.length) return { status: 'not_found' }
  const found = fuzzyFind(all, name)
  if (found.status === 'found') {
    return {
      status:     'found',
      client:     found.match!,
      confidence: found.confidence ?? 0,
      candidates: found.candidates ?? [found.match!],
    }
  }
  if (found.status === 'ambiguous') {
    return {
      status:     'ambiguous',
      candidates: found.candidates!,
      confidence: found.confidence ?? 0,
    }
  }
  return { status: 'not_found' }
}

/**
 * Returns true when a `found` resolution doesn't meet the write-tool
 * confidence bar. Callers should NOT silently proceed in this case — they
 * should surface the candidate list and ask the user to confirm. Reads
 * (last-visit, list-appointments, search-clients) intentionally never call
 * this helper: they may be wrong, but they're never destructive.
 */
export function needsConfirmation(r: ResolveOk): boolean {
  return r.confidence < WRITE_CONFIDENCE_THRESHOLD
}

/**
 * Builds the disambiguation prompt for a low-confidence write match. We list
 * the top candidate first, then up to two siblings. The voice agent reads
 * this back to the user and waits for a one-word reply (handled by the
 * delete-client fast-path's Shape D, schedule's no-fast-path, etc.).
 */
export function formatConfirmationPrompt(r: ResolveOk, query: string): string {
  const others = r.candidates.filter(c => c.id !== r.client.id).slice(0, 2)
  if (others.length === 0) {
    return `Entendí "${query}" como ${r.client.name}. ¿Confirmas?`
  }
  const names = [r.client.name, ...others.map(c => c.name)].join(', ')
  return `No estoy seguro a quién te refieres con "${query}". ¿Es ${names}?`
}

export function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D+/g, '')
}

/**
 * Returns up to `limit` first-name tokens of the business's most-recently-
 * active clients, deduplicated and sorted. Used as the keyword-boost list for
 * Deepgram STT — telling the recogniser "these are real names you'll hear in
 * this business" dramatically improves transcription accuracy for clients
 * like Lisset / Lizeth that the model would otherwise mishear.
 *
 * We boost ONLY first names: they are the distinctive token the user typically
 * says when referring to a client. Boosting full names would dilute the bias
 * across less-relevant surnames. The cap (default 50) matches Deepgram's
 * comfortable upper bound — beyond that, the boost effect levels off.
 */
// deno-lint-ignore no-explicit-any
export async function getClientFirstNamesForBoost(
  supabase:   SupabaseClient<any, any, any>,
  businessId: string,
  limit = 50,
): Promise<string[]> {
  const { data } = await supabase
    .from('clients')
    .select('name')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('last_visit_at', { ascending: false, nullsFirst: false })
    .order('created_at',    { ascending: false })
    .limit(limit * 2) // overscan: dedup may collapse rows
  if (!data) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data as Array<{ name: string | null }>) {
    const first = (row.name ?? '').trim().split(/\s+/)[0] ?? ''
    if (first.length < 2) continue
    const key = first.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(first)
    if (out.length >= limit) break
  }
  return out
}
