/**
 * delete_client — removes a client by name, with explicit-consent handling
 * for duplicate disambiguation.
 *
 * Three lookup branches:
 *   - Phone disambiguator passed → pick the exact match.
 *   - Multiple same-name candidates with the same phone (looks like a real
 *     duplicate) → require `any_duplicate=true` to proceed, otherwise ask.
 *   - Multiple same-name candidates with different phones → require the user
 *     to pick by phone.
 *
 * Refuses if the target has future pending/confirmed appointments. The user
 * must cancel those first — silently deleting a client with bookings would
 * orphan rows and confuse the dashboard.
 */

import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { type ClientRow, resolveClient, normalisePhone } from '../../core/repos/clients.ts'

export interface DeleteClientArgs extends Record<string, unknown> {
  client_name:    string
  phone?:         string
  any_duplicate?: boolean
}

export async function executeDeleteClient(
  ctx:  ToolContext,
  args: DeleteClientArgs,
): Promise<ToolResult> {
  if (!args.client_name) return { success: false, result: 'Necesito el nombre del cliente.' }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  let target: ClientRow
  if (resolution.status === 'found') {
    target = resolution.client
  } else {
    const candidates = resolution.candidates
    const wantedPhone = normalisePhone(args.phone)

    if (!wantedPhone) {
      const phones = candidates.map(c => normalisePhone(c.phone))
      const allSame = phones.every(p => p === phones[0])
      // any_duplicate=true is the user's explicit consent after they've seen
      // the disambiguation list and answered with an ordinal/anaphoric
      // pick ("el primero", "al otro", "cualquiera"). Whether phones match
      // or not, the user already accepted the candidate list — picking the
      // first one matches what the fast path detected. If we kept asking
      // for a phone here the FAB bounces between "¿Cuál elimino?" turns and
      // the user never gets to delete.
      if (args.any_duplicate) {
        target = candidates[0]!
      } else if (allSame) {
        const phoneStr = phones[0] ? `con el mismo teléfono ${candidates[0]!.phone}` : 'sin teléfono registrado'
        return {
          success: false,
          result: `Tengo ${candidates.length} clientes llamados ${candidates[0]!.name} ${phoneStr} — parecen duplicados. ¿Elimino uno y dejo el otro?`,
        }
      } else {
        const list = candidates
          .map(c => c.phone ? `${c.name} con teléfono ${c.phone}` : `${c.name} sin teléfono`)
          .join(', ')
        return { success: false, result: `Hay varios clientes llamados ${candidates[0]!.name}: ${list}. ¿Cuál elimino, dime el teléfono?` }
      }
    } else {
      const matches = candidates.filter(c => normalisePhone(c.phone) === wantedPhone)
      if (matches.length === 0) {
        return { success: false, result: `No encontré a ${args.client_name} con el teléfono ${args.phone}.` }
      }
      target = matches[0]!
    }
  }

  const { count } = await ctx.supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .eq('client_id', target.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())

  if ((count ?? 0) > 0) {
    return { success: false, result: `No se puede eliminar: ${target.name} tiene ${count} cita(s) futura(s). Cancélalas primero.` }
  }

  const { error } = await ctx.supabase
    .from('clients')
    .delete()
    .eq('id', target.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude eliminar: ${error.message}` }
  const phoneSuffix = target.phone ? ` (teléfono ${target.phone})` : ''
  return { success: true, result: `Cliente ${target.name}${phoneSuffix} eliminado.` }
}
