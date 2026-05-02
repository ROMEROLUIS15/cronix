/**
 * ServiceResolver.ts — Resolución determinística de servicios.
 *
 * Antes duplicado en:
 *   - RealToolExecutor.resolveService() (UUID exacto + fuzzy por nombre)
 *   - appointment.tools.ts (fuzzyFind sobre getActive())
 *   - WhatsApp tool-executor (services.find + name.includes fallback)
 *
 * Ahora: una sola implementación con la estrategia de match más robusta.
 */

import type { IServiceRepository, ServiceForDropdown } from '@/lib/domain/repositories/IServiceRepository'
import type { TenantContext } from '../security/TenantEnforcer'
import { fuzzyFind } from '@/lib/ai/fuzzy-match'

// ── Resultado discriminado ────────────────────────────────────────────────────

export type ServiceResolution =
  | { status: 'found';     service: ServiceForDropdown }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: ServiceForDropdown[] }

// ── Resolver ──────────────────────────────────────────────────────────────────

export class ServiceResolver {
  constructor(private repo: IServiceRepository) {}

  /**
   * Resuelve un servicio por nombre o UUID.
   *
   * Estrategia (en orden de precisión):
   *   1. UUID exacto → match directo
   *   2. Nombre exacto (case-insensitive) → match directo
   *   3. Fuzzy match por nombre → tolerante a errores de transcripción
   *   4. Substring: el texto del LLM contiene el nombre del servicio
   *
   * Retorna 'ambiguous' cuando el fuzzy match encuentra múltiples candidatos
   * sobre el threshold — el adapter decide cómo presentarlos al usuario.
   */
  async resolve(ctx: TenantContext, serviceIdOrName: string): Promise<ServiceResolution> {
    const result = await this.repo.getActive(ctx.businessId)
    if (result.error || !result.data || result.data.length === 0) {
      return { status: 'not_found' }
    }

    const services = result.data

    // Estrategia 1: UUID exacto
    const byId = services.find((s) => s.id === serviceIdOrName)
    if (byId) return { status: 'found', service: byId }

    // Estrategia 2: nombre exacto (normalizado)
    const needle = normalize(serviceIdOrName)
    const byExact = services.find((s) => normalize(s.name) === needle)
    if (byExact) return { status: 'found', service: byExact }

    // Estrategia 3: fuzzy match (Levenshtein — robusto a typos)
    const fuzzyResult = fuzzyFind(services, serviceIdOrName)
    if (fuzzyResult.status === 'found')    return { status: 'found',    service: fuzzyResult.match as ServiceForDropdown }
    if (fuzzyResult.status === 'ambiguous') return { status: 'ambiguous', candidates: fuzzyResult.candidates as ServiceForDropdown[] }

    // Estrategia 4: substring (el LLM incluye el nombre dentro de una frase)
    const bySubstring = services.find((s) => needle.includes(normalize(s.name)) || normalize(s.name).includes(needle))
    if (bySubstring) return { status: 'found', service: bySubstring }

    return { status: 'not_found' }
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}
