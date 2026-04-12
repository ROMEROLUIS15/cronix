/**
 * tool-definitions.write.ts — WRITE AI tool registrations.
 * Appointment CRUD, payments, client creation, WhatsApp reactivation.
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

export const writeToolDefinitions: ToolDefinition[] = [
  // ── Appointments ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Agenda una cita. Requiere cliente, servicio y fecha+hora (ISO 8601).',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          service_name: { type: 'string' },
          date: { type: 'string', description: 'ISO 8601 con hora.' },
          staff_name: { type: 'string', description: 'Empleado asignado (opcional).' },
        },
        required: ['client_name', 'service_name', 'date'],
      },
    },
    handler: makeHandler(
      (bizId, args, tz) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        service_name: String(args.service_name ?? ''),
        date: String(args.date ?? ''),
        staff_name: args.staff_name !== undefined ? String(args.staff_name) : undefined,
        timezone: tz,
      }),
      tools.book_appointment as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancela una cita activa.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          appointment_date: { type: 'string', description: 'ISO 8601. Si hay varias citas.' },
        },
        required: ['client_name'],
      },
    },
    handler: makeHandler(
      (bizId, args, tz) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        appointment_date: args.appointment_date !== undefined ? String(args.appointment_date) : undefined,
        timezone: tz,
      }),
      tools.cancel_appointment as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: 'Reagenda una cita a nueva fecha/hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          new_date: { type: 'string', description: 'ISO 8601 con hora.' },
          old_date: { type: 'string', description: 'ISO 8601 de la cita actual.' },
        },
        required: ['client_name', 'new_date'],
      },
    },
    handler: makeHandler(
      (bizId, args, tz) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        new_date: String(args.new_date ?? ''),
        old_date: args.old_date !== undefined ? String(args.old_date) : undefined,
        timezone: tz,
      }),
      tools.reschedule_appointment as any,
    ),
  },

  // ── Finance & CRM ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'register_payment',
      description: 'Registra un cobro de un cliente.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          amount: { type: 'number' },
          method: { type: 'string', enum: ['efectivo', 'tarjeta', 'transferencia', 'qr'] },
        },
        required: ['client_name', 'amount', 'method'],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        amount: Number(args.amount ?? 0),
        method: String(args.method ?? ''),
      }),
      tools.register_payment as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Registra un cliente nuevo. Verifica duplicados.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          phone: { type: 'string', description: 'Teléfono para WhatsApp.' },
          email: { type: 'string', description: 'Email (opcional).' },
        },
        required: ['client_name', 'phone'],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        client_name: String(args.client_name ?? ''),
        phone: String(args.phone ?? ''),
        email: args.email !== undefined ? String(args.email) : undefined,
      }),
      tools.create_client as any,
    ),
  },

  {
    type: 'function',
    function: {
      name: 'send_reactivation_message',
      description: 'Envía WhatsApp de reactivación a cliente inactivo.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          client_name: { type: 'string' },
        },
        required: ['client_id', 'client_name'],
      },
    },
    handler: makeHandler(
      (bizId, args) => ({
        business_id: bizId,
        client_id: String(args.client_id ?? ''),
        client_name: String(args.client_name ?? ''),
      }),
      tools.send_reactivation_message as any,
    ),
  },
]
