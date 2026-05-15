import type { ToolContext } from '../tool-context.ts'
import { fuzzyFind } from '../fuzzy.ts'

export interface ServiceRow { id: string; name: string; duration_min: number; price: number }

export async function getActiveServices(ctx: ToolContext): Promise<ServiceRow[]> {
  const { data, error } = await ctx.supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', ctx.businessId)
    .eq('is_active', true)
  if (error || !data) return []
  return data as ServiceRow[]
}

export async function resolveService(ctx: ToolContext, nameOrId: string): Promise<ServiceRow | null> {
  const all = await getActiveServices(ctx)
  if (!all.length) return null
  const exact = all.find(s => s.id === nameOrId)
  if (exact) return exact
  const fuzzy = fuzzyFind(all, nameOrId)
  return fuzzy.status === 'found' ? fuzzy.match! : null
}
