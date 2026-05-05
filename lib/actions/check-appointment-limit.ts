'use server'

import { createClient } from '@/lib/supabase/server'
import { getAppointmentMonthLimit } from '@/lib/plans/plan-limits'
import { startOfMonth, endOfMonth } from 'date-fns'

export async function checkAppointmentLimit(businessId: string): Promise<{
  allowed: boolean
  current: number
  limit: number
  plan: string
}> {
  const supabase = await createClient()

  const { data: biz, error } = await supabase
    .from('businesses')
    .select('plan, bonus_appointments_limit')
    .eq('id', businessId)
    .single()

  if (error) console.error('[checkAppointmentLimit] query failed:', error.message)

  const plan = biz?.plan ?? 'free'
  const limit = getAppointmentMonthLimit({
    plan,
    bonus_appointments_limit: biz?.bonus_appointments_limit
  })

  if (!isFinite(limit)) {
    return { allowed: true, current: 0, limit: Infinity, plan }
  }

  const now = new Date()
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('start_at', startOfMonth(now).toISOString())
    .lte('start_at', endOfMonth(now).toISOString())
    .not('status', 'in', '("cancelled","no_show")')

  const current = count ?? 0
  return { allowed: current < limit, current, limit, plan }
}
