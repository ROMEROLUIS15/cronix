/**
 * results.ts — Results of the phone agent's API and the call record they all start from.
 *
 * A business outcome is `{ success: false, error: CODE }` with HTTP 200 (contract §6); the
 * business of a call always comes from its record, never from the request.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ApiResult = { success: boolean; error?: string; [field: string]: unknown }

export function fail(error: string): ApiResult {
  return { success: false, error }
}

export interface CallBusiness {
  businessId: string
  timezone:   string
  settings:   Record<string, unknown>
}

/** A call's business, or the refusal for a call no endpoint may read yet. */
export type CallLookup = { found: CallBusiness } | { refused: ApiResult }

/**
 * The business of a call, from its record. Refuses an unknown call (`NOT_FOUND`) and a
 * WhatsApp call whose caller has not named the business yet (`BUSINESS_NOT_SET`, §4.1b):
 * every endpoint that reads a business goes through here.
 */
export async function businessOfCall(supabase: SupabaseClient, callSid: string): Promise<CallLookup> {
  const call = await supabase.from('phone_agent_calls').select('business_id').eq('call_sid', callSid).maybeSingle()
  if (call.error) throw new Error(`phone_agent_calls: ${call.error.message}`)
  if (!call.data) return { refused: fail('NOT_FOUND') }
  const businessId = (call.data as { business_id: string | null }).business_id
  if (!businessId) return { refused: fail('BUSINESS_NOT_SET') }
  const biz = await supabase.from('businesses').select('timezone, settings').eq('id', businessId).single()
  if (biz.error) throw new Error(`businesses: ${biz.error.message}`)
  const data = biz.data as { timezone: string | null; settings: Record<string, unknown> | null }
  return { found: { businessId, timezone: data.timezone ?? 'UTC', settings: data.settings ?? {} } }
}
