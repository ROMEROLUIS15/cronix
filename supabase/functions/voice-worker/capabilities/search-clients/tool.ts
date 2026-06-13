import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { getActiveClients, resolveClient } from '../../core/repos/clients.ts'
import { nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'

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

  // Anti-substitution guard — same rationale as last_visit: don't let the LLM
  // search for a registered name the user never uttered.
  const corpus = ctx.userTextCorpus ?? ''
  if (corpus && !nameMentionedInCorpus(corpus, args.query)) {
    console.log(`[VOICE-WORKER-SEARCH-CLIENTS] REJECTED — hallucinated query="${args.query}"`)
    return { success: false, result: 'No te entendí bien el nombre. ¿A quién busco?', error: 'GUARD_REJECTED' }
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
