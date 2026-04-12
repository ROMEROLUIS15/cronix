/**
 * tool-definitions.read.ts — READ-only AI tool registrations.
 * Dashboard stats, client queries, service catalog.
 */

import * as tools from './assistant-tools'
import type { ToolDefinition } from './tool-registry'
import { buildToolContext } from './tools/_context'

function makeHandler(
  buildArgs: (bizId: string, args: Record<string, unknown>, tz?: string) => Record<string, unknown>,
  toolFn: (args: Record<string, unknown>, ctx: Awaited<ReturnType<typeof buildToolContext>>) => Promise<string>,
): ToolDefinition['handler'] {
  return async (bizId, args, tz) => {
    const ctx = await buildToolContext()
    return toolFn(buildArgs(bizId, args, tz), ctx)
  }
}

export const readToolDefinitions: ToolDefinition[] = [
  // ── Agenda por fecha ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_appointments_by_date',
      description: 'Lista todas las citas de un día específico (mañana, pasado mañana, una fecha exacta). Incluye hora, cliente y servicio.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type:        'string',
            description: 'Fecha en formato YYYY-MM-DD o ISO completo. El LLM calcula la fecha a partir de "mañana", "el viernes", etc.',
          },
        },
        required: ['date'],
      },
    },
    handler: makeHandler(
      (bizId, args, tz) => ({
        business_id: bizId,
        date:        String(args.date ?? ''),
        timezone:    tz,
      }),
      tools.get_appointments_by_date as any,
    ),
  },

  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_today_summary',
      description: 'Resumen del día: ingresos y estado de citas.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId) => ({ business_id: bizId }),
      tools.get_today_summary as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_upcoming_gaps',
      description: 'Horarios ocupados hoy para identificar espacios libres.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId, _, tz) => ({ business_id: bizId, timezone: tz }),
      tools.get_upcoming_gaps as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_inactive_clients',
      description: 'Clientes sin visita en más de 60 días.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId) => ({ business_id: bizId }),
      tools.get_inactive_clients as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_revenue_stats',
      description: 'Ingresos de esta semana vs semana anterior.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId) => ({ business_id: bizId }),
      tools.get_revenue_stats as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_monthly_forecast',
      description: 'Proyección de ingresos al cierre del mes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId) => ({ business_id: bizId }),
      tools.get_monthly_forecast as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_services',
      description: 'Catálogo completo de servicios del negocio con nombre, precio y duración.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: makeHandler(
      (bizId) => ({ business_id: bizId }),
      tools.get_services as any,
    ),
  },

  // ── Clients & Staff ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_client_debt',
      description: 'Citas completadas sin pago de un cliente.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string' } },
        required: ['client_name'],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
      }),
      tools.get_client_debt as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_client_appointments',
      description: 'Lista citas próximas activas de un cliente.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string' } },
        required: ['client_name'],
      },
    },
    handler: makeHandler(
      (bizId, args, tz) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        timezone: tz,
      }),
      tools.get_client_appointments as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_clients',
      description: 'Lista clientes o busca uno por nombre.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Filtro por nombre (opcional).' } },
        required: [],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        query: args.query !== undefined ? String(args.query) : undefined,
      }),
      tools.get_clients as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'get_staff',
      description: 'Lista empleados o busca uno por nombre.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Filtro por nombre (opcional).' } },
        required: [],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        query: args.query !== undefined ? String(args.query) : undefined,
      }),
      tools.get_staff as any,
    ),
  },
]
