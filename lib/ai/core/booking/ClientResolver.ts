/**
 * ClientResolver.ts — Resolución determinística de clientes.
 *
 * Centraliza los dos patrones de lookup que antes vivían duplicados:
 *   - Por nombre con fuzzy match (dashboard: el owner dicta el nombre)
 *   - Por teléfono (WhatsApp: el número del remitente es la identidad)
 *
 * Nunca lanza. Siempre retorna un ClientResolution discriminado.
 */

import type { IClientRepository, ClientForAI } from '@/lib/domain/repositories/IClientRepository'
import type { TenantContext } from '../security/TenantEnforcer'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'

// ── Resultado discriminado ────────────────────────────────────────────────────

export type ClientResolution =
  | { status: 'found';     client:     ClientForAI }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: ClientForAI[] }

// ── Resolver ──────────────────────────────────────────────────────────────────

export class ClientResolver {
  constructor(private repo: IClientRepository) {}

  /**
   * Resolución por nombre con fuzzy match (canal dashboard / voz).
   * Busca en todos los clientes activos del negocio.
   *
   * Threshold: 0.45 (tolerante para transcripciones de voz).
   */
  async byName(ctx: TenantContext, name: string): Promise<ClientResolution> {
    const result = await this.repo.findActiveForAI(ctx.businessId)
    if (result.error || !result.data) return { status: 'not_found' }

    const found = fuzzyFind(result.data, name)

    if (found.status === 'found')    return { status: 'found',    client: found.match }
    if (found.status === 'ambiguous') return { status: 'ambiguous', candidates: found.candidates }
    return { status: 'not_found' }
  }

  /**
   * Resolución por ID exacto (cuando el cliente ya fue identificado en un turno previo).
   */
  async byId(ctx: TenantContext, clientId: string): Promise<ClientResolution> {
    const result = await this.repo.getById(clientId, ctx.businessId)
    if (result.error || !result.data) return { status: 'not_found' }
    return { status: 'found', client: result.data }
  }

  /**
   * Resolución por teléfono (canal WhatsApp: el número del remitente es la identidad).
   * Normaliza dígitos y maneja la variante venezolana (58 0424 vs 58 424).
   */
  async byPhone(ctx: TenantContext, phone: string): Promise<ClientResolution> {
    const digits = phone.replace(/\D/g, '')
    const result = await this.repo.findActiveForAI(ctx.businessId)
    if (result.error || !result.data) return { status: 'not_found' }

    const match = result.data.find((c) => {
      if (!c.phone) return false
      return phonesMatch(c.phone, digits)
    })

    return match ? { status: 'found', client: match } : { status: 'not_found' }
  }

  /**
   * Resolución combinada: intenta byId → byName según lo disponible.
   * Punto de entrada principal para el BookingEngine.
   */
  async resolve(
    ctx:    TenantContext,
    opts:   { clientId?: string; clientName?: string },
  ): Promise<ClientResolution> {
    if (opts.clientId)   return this.byId(ctx, opts.clientId)
    if (opts.clientName) return this.byName(ctx, opts.clientName)
    return { status: 'not_found' }
  }
}

// ── Helper de normalización de teléfono ──────────────────────────────────────
// Espejado de la lógica en supabase/functions/process-whatsapp/tool-executor.ts
// y fn_find_client_by_phone. Una sola implementación en JS.

function phonesMatch(stored: string, incoming: string): boolean {
  const a = stored.replace(/\D/g, '')
  const b = incoming.replace(/\D/g, '')
  if (!a || !b) return false
  if (a === b) return true

  // Variante venezolana: 58 0424... vs 58 424...
  if (a.length >= 3 && b.length >= 3) {
    const aStripped = `${a.slice(0, 2)}${a.slice(3)}`
    const bStripped = `${b.slice(0, 2)}${b.slice(3)}`
    if (a.charAt(2) === '0' && aStripped === b) return true
    if (b.charAt(2) === '0' && bStripped === a) return true
  }
  return false
}
