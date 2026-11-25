/**
 * business-choice.ts — The caller names the business of a WhatsApp call (contract §4.1b).
 *
 * Only for a WhatsApp call recorded without a business (no session and no client phone
 * decided it). The spoken name is compared with every business; a reliable match sets the
 * call's business once and answers the same context as the start. The business never comes
 * from the request: only the name the caller said, matched here. A phone line call already
 * has its business from the dialed number, so it answers ALREADY_SET. This never anchors a
 * `wa_sessions` row: a call does not change how the sender's messages are routed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { callContext } from './calls.ts'
import { fail, type ApiResult } from './results.ts'

const MAX_SPOKEN_NAME = 120
const MAX_CANDIDATES = 3

interface NamedBusiness {
  id:   string
  name: string
}

/** Words a caller adds around a name ("la barbería de Ana"): they never tell businesses apart. */
const FILLER_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'the', 'of'])

/**
 * Lowercase, without accents, punctuation or filler words, single spaces: how a said and a
 * stored name compare.
 */
export function comparableName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter((w) => w !== '' && !FILLER_WORDS.has(w)).join(' ')
}

/**
 * The businesses a spoken name points to: those whose name is exactly the one said; when
 * none, those whose name contains it, or is contained in it when that name has more than one
 * word, as whole words ("ana" is not inside "banana"). A one-word name inside a longer phrase
 * ("María" in "la peluquería de María") is not reliable enough to choose a business.
 */
export function businessesNamed(spoken: string, businesses: ReadonlyArray<NamedBusiness>): NamedBusiness[] {
  const said = comparableName(spoken)
  const exact = businesses.filter((b) => comparableName(b.name) === said)
  if (exact.length > 0) return exact
  const asWords = (s: string) => ` ${s} `
  return businesses.filter((b) => {
    const name = comparableName(b.name)
    const saidInsideName = asWords(name).includes(asWords(said))
    const nameInsideSaid = name.includes(' ') && asWords(said).includes(asWords(name))
    return name !== '' && (saidInsideName || nameInsideSaid)
  })
}

export async function chooseBusiness(
  supabase: SupabaseClient, callSid: string, body: { spoken_name?: unknown },
): Promise<ApiResult> {
  const spoken = body.spoken_name
  if (typeof spoken !== 'string' || spoken.length > MAX_SPOKEN_NAME || !comparableName(spoken)) return fail('INVALID_ARGS')

  const call = await supabase.from('phone_agent_calls').select('business_id, channel, caller_phone')
    .eq('call_sid', callSid).maybeSingle()
  if (call.error) throw new Error(`phone_agent_calls: ${call.error.message}`)
  if (!call.data) return fail('NOT_FOUND')
  const record = call.data as { business_id: string | null; channel: string; caller_phone: string | null }
  if (record.channel !== 'whatsapp' || record.business_id) return fail('ALREADY_SET')

  const all = await supabase.from('businesses').select('id, name').order('name')
  if (all.error) throw new Error(`businesses: ${all.error.message}`)
  const named = businessesNamed(spoken, (all.data ?? []) as NamedBusiness[])
  if (named.length === 0) return fail('NO_MATCH')
  if (named.length > 1) return { ...fail('AMBIGUOUS'), candidates: named.slice(0, MAX_CANDIDATES).map((b) => b.name) }
  const chosen = named[0]!

  // Set only while the call has none: a concurrent choice cannot overwrite it.
  const set = await supabase.from('phone_agent_calls').update({ business_id: chosen.id })
    .eq('call_sid', callSid).eq('channel', 'whatsapp').is('business_id', null).select('call_sid')
  if (set.error) throw new Error(`phone_agent_calls: ${set.error.message}`)
  if ((set.data ?? []).length === 0) return fail('ALREADY_SET')
  return await callContext(supabase, chosen.id, record.caller_phone)
}
