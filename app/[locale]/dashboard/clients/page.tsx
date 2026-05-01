import { redirect } from 'next/navigation'
import { getBusinessId } from '@/lib/auth/get-business-id'
import { ClientsView } from './clients-view'
import { getClients, getClientDebts } from './actions'
import type { Client } from '@/types'
import { createClient } from '@/lib/supabase/server'
import { getClientLimit } from '@/lib/plans/plan-limits'

export default async function ClientsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const supabase = await createClient()
  const [clients, debts, bizResult] = await Promise.all([
    getClients(businessId),
    getClientDebts(businessId),
    supabase.from('businesses').select('plan').eq('id', businessId).single(),
  ])

  const plan = bizResult.data?.plan ?? 'free'
  const clientLimit = getClientLimit(plan)

  const clientsWithDebt = clients.map(c => ({
    ...c,
    total_debt: debts[c.id] || 0
  })) as Client[]

  return (
    <ClientsView
      initialClients={clientsWithDebt}
      plan={plan}
      clientLimit={clientLimit}
    />
  )
}
