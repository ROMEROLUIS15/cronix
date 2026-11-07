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
