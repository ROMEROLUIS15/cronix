import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'
import { getActiveServices } from '../../core/repos/services.ts'

export interface GetServicesArgs extends Record<string, unknown> {
  // no parameters
}

export async function executeGetServices(ctx: ToolContext): Promise<ToolResult> {
  const all = await getActiveServices(ctx)
  if (!all.length) return { success: true, result: 'No hay servicios configurados.' }
  const lines = all.map(s => `${s.name} (${s.duration_min} min, $${s.price})`)
  return { success: true, result: `Servicios disponibles: ${lines.join(', ')}.` }
}
