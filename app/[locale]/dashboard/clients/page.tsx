import { redirect } from 'next/navigation'
import { getBusinessId } from '@/lib/auth/get-business-id'
import { ClientsView } from './clients-view'
import { getClients, getClientDebts } from './actions'
import type { Client } from '@/types'

export default async function ClientsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const [clients, debts] = await Promise.all([
    getClients(businessId),
    getClientDebts(businessId)
  ])

  const clientsWithDebt = clients.map(c => ({
    ...c,
    total_debt: debts[c.id] || 0
  })) as Client[]

  return <ClientsView initialClients={clientsWithDebt} />
}
