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
  handler: (businessId: string, args: any, timezone?: string) => Promise<string>
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  constructor() {
    this.register({
      type: 'function',
      function: {
        name: 'get_today_summary',
        description: 'Resumen del día: ingresos y estado de citas.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_today_summary(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_upcoming_gaps',
        description: 'Horarios ocupados hoy para identificar espacios libres.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId, _args, tz) => tools.get_upcoming_gaps(bizId, tz)
    })

    this.register({
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
      handler: (bizId, args) => tools.get_client_debt(bizId, args.client_name)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_client_appointments',
        description: 'Lista citas próximas activas de un cliente. Usar antes de cancelar/reagendar cuando hay múltiples citas.',
        parameters: {
          type: 'object',
          properties: { client_name: { type: 'string' } },
          required: ['client_name'],
        },
      },
      handler: (bizId, args, tz) => tools.get_client_appointments(bizId, args.client_name, tz)
    })

    this.register({
      type: 'function',
      function: {
        name: 'cancel_appointment',
        description: 'Cancela una cita activa. Con una sola cita actúa directo. Con varias, devuelve lista para que el usuario elija; luego llamar con appointment_date.',
        parameters: {
          type: 'object',
          properties: {
            client_name:      { type: 'string' },
            appointment_date: { type: 'string', description: 'ISO 8601. Requerido si el cliente tiene varias citas.' },
          },
          required: ['client_name'],
        },
      },
      handler: (bizId, args, tz) => tools.cancel_appointment(bizId, args.client_name, args.appointment_date, tz)
    })

    this.register({
      type: 'function',
      function: {
        name: 'book_appointment',
        description: 'Agenda una cita. Requiere cliente, servicio y fecha+hora (ISO 8601). Hora OBLIGATORIA.',
        parameters: {
          type: 'object',
          properties: {
            client_name:  { type: 'string' },
            service_name: { type: 'string' },
            date:         { type: 'string', description: 'ISO 8601 con hora (YYYY-MM-DDTHH:mm:ss).' },
            staff_name:   { type: 'string', description: 'Empleado asignado (opcional).' },
          },
          required: ['client_name', 'service_name', 'date'],
        },
      },
      handler: (bizId, args, tz) => tools.book_appointment(bizId, args.client_name, args.service_name, args.date, args.staff_name, tz)
    })

    this.register({
      type: 'function',
      function: {
        name: 'reschedule_appointment',
        description: 'Reagenda una cita a nueva fecha/hora. Con varias citas, devuelve lista; luego llamar con old_date. Valida disponibilidad.',
        parameters: {
          type: 'object',
          properties: {
            client_name: { type: 'string' },
            new_date:    { type: 'string', description: 'ISO 8601 con hora. OBLIGATORIA.' },
            old_date:    { type: 'string', description: 'ISO 8601 de la cita a reagendar (si hay varias).' },
          },
          required: ['client_name', 'new_date'],
        },
      },
      handler: (bizId, args, tz) => tools.reschedule_appointment(bizId, args.client_name, args.new_date, args.old_date, tz)
    })

    this.register({
      type: 'function',
      function: {
        name: 'register_payment',
        description: 'Registra un cobro de un cliente.',
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
        description: 'Clientes sin visita en más de 60 días.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_inactive_clients(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_revenue_stats',
        description: 'Ingresos de esta semana vs semana anterior.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_revenue_stats(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_monthly_forecast',
        description: 'Proyección de ingresos al cierre del mes.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      handler: (bizId) => tools.get_monthly_forecast(bizId)
    })

    this.register({
      type: 'function',
      function: {
        name: 'send_reactivation_message',
        description: 'Envía WhatsApp de reactivación a cliente inactivo.',
        parameters: {
          type: 'object',
          properties: {
            client_id:   { type: 'string' },
            client_name: { type: 'string' },
          },
          required: ['client_id', 'client_name'],
        },
      },
      handler: (bizId, args) => tools.send_reactivation_message(bizId, args.client_id, args.client_name)
    })

    this.register({
      type: 'function',
      function: {
        name: 'create_client',
        description: 'Registra un cliente nuevo. Verifica duplicados antes de crear. Requiere nombre y teléfono.',
        parameters: {
          type: 'object',
          properties: {
            client_name: { type: 'string' },
            phone:       { type: 'string', description: 'Teléfono para WhatsApp (obligatorio).' },
            email:       { type: 'string', description: 'Email (opcional).' },
          },
          required: ['client_name', 'phone'],
        },
      },
      handler: (bizId, args) => tools.create_client(bizId, args.client_name, args.phone, args.email)
    })

    this.register({
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
      handler: (bizId, args) => tools.get_clients(bizId, args.query)
    })

    this.register({
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
      handler: (bizId, args) => tools.get_staff(bizId, args.query)
    })

    this.register({
      type: 'function',
      function: {
        name: 'get_services',
        description: 'Catálogo de servicios con precios y duración.',
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

  async execute(name: string, args: any, businessId: string, timezone?: string): Promise<string> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool ${name} not found`)

    // Sanitize args: remove null/undefined values to prevent schema validation errors
    const sanitized = Object.fromEntries(
      Object.entries(args || {}).filter(([_, v]) => v !== null && v !== undefined)
    )

    return await tool.handler(businessId, sanitized, timezone)
  }
}

export const toolRegistry = new ToolRegistry()
