/**
 * crm.tools.ts — AI tools for CRM and staff operations.
 */

import { z } from 'zod'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'
import { logger } from '@/lib/logger'
import { sendReactivationMessage } from '@/lib/services/whatsapp.service'
import type { ToolContext } from './_context'
import { formatForSpeech } from './_helpers'

// ── SCHEMAS ────────────────────────────────────────────────────────────────

export const GetServicesSchema = z.object({
  business_id: z.string().uuid(),
})

export const GetStaffSchema = z.object({
  business_id: z.string().uuid(),
  query: z.string().optional(),
})

export const SendReactivationMessageSchema = z.object({
  business_id: z.string().uuid(),
  client_id: z.string().uuid(),
  client_name: z.string().min(2),
})

// ── READ: Listar servicios ─────────────────────────────────────────────────

export async function get_services(
  args: z.infer<typeof GetServicesSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetServicesSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id } = parse.data

  try {
    const result = await ctx.serviceRepo.getActive(business_id)
    if (result.error || !result.data) return 'Error al obtener la lista de servicios.'

    const data = result.data
    if (!data.length) return 'No hay servicios registrados en este negocio.'

    const list = data.map(s => `- ${s.name}: $${s.price}, ${s.duration_min} minutos`).join('\n')
    return formatForSpeech(`Servicios disponibles:\n${list}`)
  } catch (err: unknown) {
    logger.error('TOOL-DB', `get_services failed: ${err instanceof Error ? err.message : String(err)}`, { business_id })
    return 'Error al obtener la lista de servicios.'
  }
}

// ── READ: Listar staff ─────────────────────────────────────────────────────

export async function get_staff(
  args: z.infer<typeof GetStaffSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetStaffSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id, query } = parse.data

  const result = await ctx.userRepo.getTeamMembers(business_id)
  
  if (result.error || !result.data) {
    logger.error('TOOL-DB', `get_staff failed: ${result.error}`, { business_id })
    return 'Error al consultar el equipo de trabajo. Intenta de nuevo en un momento.'
  }

  const team = result.data

  if (!team.length) return 'No tienes empleados registrados aún.'

  if (query) {
    const matchResult = fuzzyFind(team, query)
    if (matchResult.status === 'found') {
      const s = matchResult.match
      return `Encontré a ${s.name}, ${s.role === 'owner' ? 'dueño' : 'empleado'}. ¿Es a quien buscas?`
    }
    if (matchResult.status === 'ambiguous') {
      const candidates = matchResult.candidates.map(c => `- ${c.name}`).join('\n')
      return formatForSpeech(`Encontré varios empleados parecidos a "${query}":\n${candidates}\n¿Cuál de ellos es?`)
    }
    return `No encontré ningún empleado llamado "${query}".`
  }

  const list = team.map(s => `- ${s.name}, ${s.role === 'owner' ? 'dueño' : 'empleado'}`).join('\n')
  return formatForSpeech(`Equipo de trabajo:\n${list}`)
}

// ── STRATEGIC: WhatsApp CRM ────────────────────────────────────────────────

export async function send_reactivation_message(
  args: z.infer<typeof SendReactivationMessageSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = SendReactivationMessageSchema.safeParse(args)
  if (!parse.success) return `Error de validación: ${parse.error.message}`
  const { business_id, client_id, client_name } = parse.data

  // Multi-tenant check via repo
  const clientResult = await ctx.clientRepo.getById(client_id, business_id)
  if (clientResult.error || !clientResult.data) {
    logger.error('S-TOOL', `Ownership breach or missing client: ${client_id} vs Biz ${business_id}`)
    return 'Error de permisos o cliente no encontrado.'
  }

  const client = clientResult.data
  if (!client.phone) return `El cliente ${client.name} no tiene un número de teléfono registrado.`

  const businessNameResult = await ctx.businessRepo.getName(business_id)
  if (businessNameResult.error || !businessNameResult.data) {
     return `No pude obtener los datos del negocio para ${client_name}.`
  }
  const businessName = businessNameResult.data

  const result = await sendReactivationMessage({
    to:           client.phone,
    clientName:   client.name,
    businessName,
  })

  if (!result.success) {
    logger.error('TOOL-WA', `send_reactivation_message failed: ${result.error}`, { business_id, client_id })
    return 'No pude enviar el mensaje de WhatsApp en este momento. Intenta de nuevo más tarde.'
  }

  return `Listo. Envié el WhatsApp de reactivación a ${client.name}.`
}
