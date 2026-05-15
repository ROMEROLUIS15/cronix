import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { getActiveClients, resolveClient } from '../../core/repos/clients.ts'

export interface SearchClientsArgs extends Record<string, unknown> {
  query: string
}

export async function executeSearchClients(
  ctx:  ToolContext,
  args: SearchClientsArgs,
): Promise<ToolResult> {
  if (!args.query || args.query.length < 2) {
    return { success: false, result: 'Necesito al menos 2 caracteres para buscar.' }
  }

  const all = await getActiveClients(ctx)
  if (!all.length) {
    return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
  }

  const resolution = await resolveClient(ctx, args.query)

  if (resolution.status === 'found') {
    const m = resolution.client
    const phoneStr = m.phone ? `, su teléfono es ${m.phone}` : ', no tiene teléfono registrado'
    return { success: true, result: `Sí, ${m.name} está entre tus clientes${phoneStr}.` }
  }

  if (resolution.status === 'ambiguous') {
    const candidates = resolution.candidates
    const opener = `Tengo ${candidates.length} clientes con nombre similar a ${args.query}.`
    const items  = candidates
      .map(c => c.phone ? `${c.name}, teléfono ${c.phone}` : `${c.name}, sin teléfono registrado`)
      .join('. ')
    return { success: true, result: `${opener} ${items}. ¿A cuál te refieres?` }
  }

  return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
}
