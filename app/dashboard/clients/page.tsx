import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessId } from '@/lib/auth/get-business-id'
import * as clientsRepo from '@/lib/repositories/clients.repo'
import { ClientsView } from './clients-view'

export default async function ClientsPage() {
  const businessId = await getBusinessId()
  if (!businessId) redirect('/dashboard/setup')

  const supabase = await createClient()
  const clients = await clientsRepo.getClients(supabase, businessId)

  return <ClientsView initialClients={clients} />
}
