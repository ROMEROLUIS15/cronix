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
        description: 'Shows a billing summary and scheduled appointments for today.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_today_summary(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_upcoming_gaps',
        description: 'Queries occupied time blocks today to identify free slots.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_upcoming_gaps(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_client_debt',
        description: 'Queries if a client has debts or completed appointments without recorded payment.',
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
        description: 'Cancels the next active appointment for a client.',
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
        description: 'Schedules a new appointment for a client, service, and specific date. Optionally with a staff member.',
        parameters: {
          type: 'object',
          properties: {
            client_name:  { type: 'string' },
            service_name: { type: 'string' },
            date:         { type: 'string', description: 'ISO 8601 format (YYYY-MM-DDTHH:mm:ss)' },
            staff_name:   { type: 'string', description: 'Optional. Name of the barber/stylist/doctor.' },
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
        description: 'Registers a payment or deposit made by a client.',
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
        description: 'Identifies clients who haven\'t had appointments in more than 60 days for reactivation.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_inactive_clients(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_revenue_stats',
        description: 'Shows a billing summary for this week compared to the previous one.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_revenue_stats(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_monthly_forecast',
        description: 'Projects total revenue at the end of the current month based on confirmed appointments and current billing.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_monthly_forecast(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'send_reactivation_message',
        description: 'Sends a reactivation message via WhatsApp to an inactive client.',
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
    
    this.register({
      type: 'function',
      function: {
        name: 'get_clients',
        description: 'Queries the client list or searches for a specific one by name/phone.',
        parameters: {
          type: 'object',
          properties: { 
            query: { type: 'string', description: 'Name or name fragment to filter (optional).' } 
          },
          required: [],
        },
      },
      handler: (bizId, args) => tools.get_clients(bizId, args.query)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_staff',
        description: 'Shows the staff list or searches for a specific one by name.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Name or name fragment to filter (optional).' }
          },
          required: [],
        },
      },
      handler: (bizId, args) => tools.get_staff(bizId, args.query)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_services',
        description: 'Queries the available services catalog, including prices and durations.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_services(bizId)
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
