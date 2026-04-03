import * as tools from './assistant-tools'

/**
 * tool-registry.ts — Dynamic registry for AI Tools.
 * Maps JSON schemas to server-side handlers.
 * 
 * V4: Added Multi-staff (book_appointment) and WhatsApp CRM.
 */

export interface ToolDefinition {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters: {
      type:       'object'
      properties: Record<string, any>
      required:   string[]
    }
  }
  handler: (businessId: string, args: any) => Promise<string>
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  constructor() {
    this.register({
      type: 'function',
      function: {
        name: 'get_today_summary',
        description: 'Muestra un resumen de facturación y citas agendadas para hoy.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_today_summary(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_upcoming_gaps',
        description: 'Consulta los bloques de tiempo ocupados hoy para identificar huecos libres.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_upcoming_gaps(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_client_debt',
        description: 'Consulta si un cliente tiene deudas o citas completadas sin pago registrado.',
        parameters: {
          type: 'object',
          properties: { client_name: { type: 'string' } },
          required: ['client_name'],
        },
      },
      handler: (bizId, args) => tools.get_client_debt(bizId, args.client_name)
    })

    this.register({
      type: 'function',
      function: {
        name: 'cancel_appointment',
        description: 'Cancela la próxima cita activa de un cliente.',
        parameters: {
          type: 'object',
          properties: { client_name: { type: 'string' } },
          required: ['client_name'],
        },
      },
      handler: (bizId, args) => tools.cancel_appointment(bizId, args.client_name)
    })

    this.register({
      type: 'function',
      function: {
        name: 'book_appointment',
        description: 'Agenda una nueva cita para un cliente, servicio y fecha específica. Opcionalmente con un empleado.',
        parameters: {
          type: 'object',
          properties: {
            client_name:  { type: 'string' },
            service_name: { type: 'string' },
            date:         { type: 'string', description: 'Formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)' },
            staff_name:   { type: 'string', description: 'Opcional. Nombre del barbero/estilista/médico.' },
          },
          required: ['client_name', 'service_name', 'date'],
        },
      },
      handler: (bizId, args) => tools.book_appointment(bizId, args.client_name, args.service_name, args.date, args.staff_name)
    })

    this.register({
      type: 'function',
      function: {
        name: 'register_payment',
        description: 'Registra un pago o abono realizado por un cliente.',
        parameters: {
          type: 'object',
          properties: {
            client_name: { type: 'string' },
            amount:      { type: 'number' },
            method:      { type: 'string', enum: ['efectivo', 'tarjeta', 'transferencia', 'qr'] },
          },
          required: ['client_name', 'amount', 'method'],
        },
      },
      handler: (bizId, args) => tools.register_payment(bizId, args.client_name, Number(args.amount), args.method)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_inactive_clients',
        description: 'Identifica clientes que no han tenido citas en más de 60 días para reactivación.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_inactive_clients(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_revenue_stats',
        description: 'Muestra un resumen de facturación de esta semana comparado con la anterior.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_revenue_stats(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_monthly_forecast',
        description: 'Proyecta los ingresos totales al final del mes actual basándose en citas confirmadas y facturación actual.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_monthly_forecast(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'send_reactivation_message',
        description: 'Envía un mensaje de reactivación por WhatsApp a un cliente inactivo.',
        parameters: {
          type: 'object',
          properties: { 
            client_id: { type: 'string' },
            client_name: { type: 'string' } 
          },
          required: ['client_id', 'client_name'],
        },
      },
      handler: (bizId, args) => tools.send_reactivation_message(bizId, args.client_id, args.client_name)
    })
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.function.name, tool)
  }

  getDefinitions() {
    return Array.from(this.tools.values()).map(t => ({
      type: t.type,
      function: t.function
    }))
  }

  async execute(name: string, args: any, businessId: string): Promise<string> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool ${name} not found`)
    return await tool.handler(businessId, args)
  }
}

export const toolRegistry = new ToolRegistry()
