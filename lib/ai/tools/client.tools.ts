/**
 * client.tools.ts — AI tools for client read/write operations.
 */

import { z } from 'zod'
import { addDays } from 'date-fns'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'
import { logger } from '@/lib/logger'
import type { ToolContext } from './_context'
import { fmtUserDate } from './_helpers'

// ── SCHEMAS ────────────────────────────────────────────────────────────────

export const GetClientDebtSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
})

export const GetClientAppointmentsSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  timezone: z.string().optional(),
})

export const GetClientsSchema = z.object({
  business_id: z.string().uuid(),
  query: z.string().optional(),
})

export const CreateClientSchema = z.object({
  business_id: z.string().uuid(),
  client_name: z.string().min(2),
  phone: z.string().regex(/^\+?[0-9\s-]{8,}$/, 'Número de teléfono inválido'),
  email: z.string().email().optional(),
})

// ── READ: Deuda de un cliente ──────────────────────────────────────────────

export async function get_client_debt(
  args: z.infer<typeof GetClientDebtSchema>,
  ctx: ToolContext
): Promise<string> {
  const result = GetClientDebtSchema.safeParse(args)
  if (!result.success) return `Error de validación: ${result.error.issues[0]?.message}`
  const { business_id, client_name } = result.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const clientsResult = await ctx.clientRepo.findActiveForAI(business_id)

  if (clientsResult.error || !clientsResult.data) {
    logger.error('TOOL-DB', `get_client_debt failed: ${clientsResult.error}`, { business_id, client_name })
    return 'Error al buscar información del cliente. Intenta de nuevo en un momento.'
  }

  if (!clientsResult.data.length) return 'No tienes clientes registrados aún.'

  const fuzzyMatch = fuzzyFind(clientsResult.data, client_name)
  if (fuzzyMatch.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (fuzzyMatch.status === 'ambiguous') return `Encontré varios clientes parecidos: ${fuzzyMatch.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client = fuzzyMatch.match

  const apptsResult = await ctx.appointmentRepo.findByDateRange(
    business_id,
    addDays(new Date(), -90).toISOString(),
    new Date().toISOString(),
    ['completed']
  )

  if (apptsResult.error || !apptsResult.data) return `El cliente ${client.name} está al día.`

  const unpaid = apptsResult.data
  if (!unpaid.length) return `El cliente ${client.name} está al día.`
  return `El cliente ${client.name} (tel: ${client.phone ?? 'sin teléfono'}) tiene ${unpaid.length} cita(s) completada(s) recientes sin registrar pago.`
}

// ── READ: Citas próximas de un cliente ────────────────────────────────────

export async function get_client_appointments(
  args: z.infer<typeof GetClientAppointmentsSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetClientAppointmentsSchema.safeParse(args)
  if (!parse.success) return `Datos inválidos: ${parse.error.message}`
  const { business_id, client_name, timezone = 'UTC' } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const clientsResult = await ctx.clientRepo.findActiveForAI(business_id)
  if (clientsResult.error || !clientsResult.data) return 'Error al buscar el cliente.'

  const fuzzyMatch = fuzzyFind(clientsResult.data, client_name)
  if (fuzzyMatch.status === 'not_found') return `No encontré ningún cliente llamado "${client_name}".`
  if (fuzzyMatch.status === 'ambiguous') return `Encontré varios clientes parecidos: ${fuzzyMatch.candidates.map(c => c.name).join(', ')}. ¿A cuál te refieres?`

  const client      = fuzzyMatch.match
  const apptsResult = await ctx.appointmentRepo.findUpcomingByClient(business_id, client.id)
  if (apptsResult.error || !apptsResult.data) return 'Error al consultar las citas del cliente.'

  const appts = apptsResult.data
  if (!appts.length) return `${client.name} no tiene citas próximas activas.`

  const list = appts.map(a => {
    const serviceName = (a.services as { name: string } | null)?.name ?? 'Servicio sin especificar'
    const dateStr     = fmtUserDate(a.start_at, timezone, "EEEE d 'de' MMMM 'a las' h:mm a")
    return `- ${serviceName} el ${dateStr}`
  }).join('\n')

  return `Citas próximas de ${client.name}:\n${list}`
}

// ── READ: Listar clientes ──────────────────────────────────────────────────

export async function get_clients(
  args: z.infer<typeof GetClientsSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = GetClientsSchema.safeParse(args)
  if (!parse.success) return `Error: ${parse.error.message}`
  const { business_id, query } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const result = await ctx.clientRepo.getAllForSelect(business_id)

  if (result.error || !result.data) {
    logger.error('TOOL-DB', `get_clients failed: ${result.error}`, { business_id })
    return 'Error al consultar la lista de clientes. Intenta de nuevo en un momento.'
  }

  if (!result.data.length) return 'No tienes clientes registrados aún.'

  if (query) {
    const fuzzyResult = fuzzyFind(result.data, query)
    if (fuzzyResult.status === 'found') {
      const c = fuzzyResult.match
      return `He encontrado a ${c.name}${c.phone ? ` (Tel: ${c.phone})` : ''}. ¿Es a quien te refieres?`
    }
    if (fuzzyResult.status === 'ambiguous') {
      const candidates = fuzzyResult.candidates.map(c => `- ${c.name}`).join('\n')
      return `Encontré varios clientes parecidos a "${query}":\n${candidates}\n¿Cuál de ellos es?`
    }
    return `No encontré ningún cliente llamado "${query}". ¿Te gustaría que lo registre?`
  }

  const list = result.data.map(c => `- ${c.name}${c.phone ? ` (Tel: ${c.phone})` : ''}`).join('\n')
  return `Aquí tienes a tus clientes registrados:\n${list}`
}

// ── STRATEGIC: Clientes inactivos ─────────────────────────────────────────

export async function get_inactive_clients(
  args: { business_id: string },
  ctx: ToolContext
): Promise<string> {
  const { business_id } = args
  const sixtyDaysAgo = addDays(new Date(), -60).toISOString()
  const result       = await ctx.clientRepo.findInactive(business_id, sixtyDaysAgo)

  if (result.error || !result.data) {
    logger.error('TOOL-DB', `get_inactive_clients failed: ${result.error}`, { business_id })
    return 'Error consultando clientes (High Load).'
  }

  if (!result.data.length) return '¡Excelente! Todos tus clientes han venido en los últimos 2 meses.'

  const names = result.data.map(c => c.name).join(', ')
  return `He identificado a ${result.data.length} clientes inactivos por más de 60 días: ${names}. Podrías enviarles un WhatsApp de reactivación.`
}

// ── WRITE: Crear cliente nuevo ────────────────────────────────────────────

export async function create_client(
  args: z.infer<typeof CreateClientSchema>,
  ctx: ToolContext
): Promise<string> {
  const parse = CreateClientSchema.safeParse(args)
  if (!parse.success) return `Datos inválidos para crear cliente: ${parse.error.issues[0]?.message}`
  const { business_id, client_name, phone, email } = parse.data

  // SECURITY: Verify business_id matches authenticated user's business
  try { await ctx.tenantGuard.verify(business_id) } catch { return 'No autorizado.' }

  const existingResult = await ctx.clientRepo.findActiveForAI(business_id)
  if (existingResult.error || !existingResult.data) {
    logger.error('TOOL-DB', `create_client list failed: ${existingResult.error}`, { business_id })
    return 'Error: no pude verificar si el cliente ya existe. Intenta de nuevo.'
  }

  const duplicate = fuzzyFind(existingResult.data, client_name)
  if (duplicate.status === 'found') {
    const d = duplicate.match
    return `El cliente "${d.name}"${d.phone ? ` (Tel: ${d.phone})` : ''} ya está registrado. No se creó un duplicado.`
  }

  const insertResult = await ctx.clientRepo.insert({
    business_id,
    name:  client_name.trim(),
    phone: phone.trim(),
    ...(email ? { email: email.trim() } : {}),
  })

  if (insertResult.error || !insertResult.data) {
    logger.error('TOOL-DB', `create_client insert failed: ${insertResult.error}`, { business_id })
    return 'Error: no pude registrar el cliente. Intenta de nuevo o verifica los datos.'
  }

  return `Listo. Cliente "${insertResult.data.name}" registrado correctamente.`
}
