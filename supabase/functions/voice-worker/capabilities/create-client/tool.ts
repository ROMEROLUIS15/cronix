import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { nameMentionedInCorpus } from '../../core/conversation/slot-extractor.ts'

export interface CreateClientArgs extends Record<string, unknown> {
  name:   string
  phone?: string
}

export async function executeCreateClient(
  ctx:  ToolContext,
  args: CreateClientArgs,
): Promise<ToolResult> {
  if (!args.name) return { success: false, result: 'Necesito el nombre del cliente.' }

  // Anti-substitution guard: never register a client under a name the user
  // never said. create_client is a write that inserts a row — a fabricated
  // name would silently pollute the roster. Same guard the other client_name
  // tools use; empty corpus ⇒ fail-open.
  const corpus = ctx.userTextCorpus ?? ''
  if (corpus && !nameMentionedInCorpus(corpus, args.name)) {
    console.log(`[VOICE-WORKER-CREATE-CLIENT] REJECTED — hallucinated name="${args.name}"`)
    return { success: false, result: 'No te entendí bien el nombre. ¿Cómo se llama el cliente?' }
  }

  const { data, error } = await ctx.supabase
    .from('clients')
    .insert({
      business_id: ctx.businessId,
      name:        args.name,
      phone:       args.phone ?? null,
    })
    .select('id, name')
    .single()

  if (error || !data) {
    const msg = error?.message ?? 'desconocido'
    if (msg.includes('idx_clients_business_phone_digits')) {
      return { success: false, result: `Ya tienes un cliente activo con el teléfono ${args.phone}.` }
    }
    if (msg.includes('idx_clients_business_email_norm')) {
      return { success: false, result: 'Ya tienes un cliente activo con ese correo.' }
    }
    return { success: false, result: `No se pudo registrar: ${msg}` }
  }
  return { success: true, result: `Cliente "${(data as { name: string }).name}" registrado.` }
}
