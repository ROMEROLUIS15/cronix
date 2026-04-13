import { createAdminClient } from './db.ts'
import type { BusinessRow } from '../types.ts'

export async function getBusinessesAt8PM(): Promise<BusinessRow[]> {
  const supabase = createAdminClient()
  const { data: businesses, error: bizErr } = await supabase.rpc(
    'fn_get_businesses_at_hour',
    { p_hour: 20 }
  )

  if (bizErr || !businesses) {
    throw new Error(bizErr?.message ?? 'No businesses found')
  }

  return businesses as BusinessRow[]
}

export function getTomorrowRange(timezone: string): { start: string; end: string } {
  const now = new Date()
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  const localDate = new Date(localDateStr + 'T00:00:00Z')
  const tomorrow = new Date(localDate.getTime() + 24 * 60 * 60 * 1000)
  const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)

  return {
    start: tomorrow.toISOString(),
    end:   dayAfter.toISOString(),
  }
}
