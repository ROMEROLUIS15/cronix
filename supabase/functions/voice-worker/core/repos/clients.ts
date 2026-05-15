import type { ToolContext } from '../tool-context.ts'
import { fuzzyFind } from '../fuzzy.ts'

export interface ClientRow { id: string; name: string; phone: string | null }

export async function getActiveClients(ctx: ToolContext): Promise<ClientRow[]> {
  const { data, error } = await ctx.supabase
    .from('clients')
    .select('id, name, phone')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
  if (error || !data) return []
  return data as ClientRow[]
}

export interface ResolveOk    { status: 'found';     client: ClientRow }
export interface ResolveAmb   { status: 'ambiguous'; candidates: ClientRow[] }
export interface ResolveMiss  { status: 'not_found' }
export type    ResolveResult  = ResolveOk | ResolveAmb | ResolveMiss

export async function resolveClient(ctx: ToolContext, name: string): Promise<ResolveResult> {
  const all = await getActiveClients(ctx)
  if (!all.length) return { status: 'not_found' }
  const found = fuzzyFind(all, name)
  if (found.status === 'found')     return { status: 'found',     client: found.match! }
  if (found.status === 'ambiguous') return { status: 'ambiguous', candidates: found.candidates! }
  return { status: 'not_found' }
}

export function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D+/g, '')
}
