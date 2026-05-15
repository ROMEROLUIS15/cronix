import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'

export interface CreateClientArgs extends Record<string, unknown> {
  name:   string
  phone?: string
}

export async function executeCreateClient(
  ctx:  ToolContext,
  args: CreateClientArgs,
): Promise<ToolResult> {
  if (!args.name) return { success: false, result: 'Necesito el nombre del cliente.' }

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
    return { success: false, result: `No se pudo registrar: ${error?.message ?? 'desconocido'}` }
  }
  return { success: true, result: `Cliente "${(data as { name: string }).name}" registrado.` }
}
