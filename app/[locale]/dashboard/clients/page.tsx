import { redirect } from 'next/navigation'
import { getBusinessId } from '@/lib/auth/get-business-id'
import { ClientsView } from './clients-view'
import { getClients } from './actions'

export default async function ClientsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const clients = await getClients(businessId)

  return <ClientsView initialClients={clients} />
}
