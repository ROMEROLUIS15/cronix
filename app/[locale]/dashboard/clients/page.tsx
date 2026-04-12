import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessId } from '@/lib/auth/get-business-id'
import { getRepos } from '@/lib/repositories'
import { ClientsView } from './clients-view'

export default async function ClientsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const supabase = await createClient()
  const { clients: clientsRepo } = getRepos(supabase)
  
  const result = await clientsRepo.getAll(businessId)
  const clients = result.data ?? []

  return <ClientsView initialClients={clients} />
}
