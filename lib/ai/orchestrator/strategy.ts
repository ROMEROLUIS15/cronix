/**
 * strategy.ts — User behavior strategies.
 *
 * Determines HOW the orchestrator behaves based on the user's role,
 * NOT based on the channel. The same user role behaves identically
 * whether they write via WhatsApp or Web.
 *
 * Responsibilities:
 *   - Whether confirmation is required before executing
 *   - Which fields are mandatory
 *   - Which tools the user can access
 *   - How to phrase collection/confirmation prompts
 */

import type { ConversationState, UserRole } from './types'

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IUserStrategy {
  readonly role: UserRole

  /** Whether this role must confirm before executing actions. */
  requiresConfirmation(state: ConversationState): boolean

  /** Which draft fields are mandatory for this role before booking. */
  getRequiredBookingFields(): string[]

  /** Whether this role can execute the given tool. */
  canExecute(toolName: string): boolean

  /** Build the prompt to ask for a missing field. */
  buildCollectionPrompt(field: string, draft: ConversationState['draft']): string

  /** Build the confirmation prompt when all data is ready. */
  buildConfirmationPrompt(draft: ConversationState['draft']): string
}

// ── ExternalUserStrategy (clients writing via WhatsApp) ───────────────────────

const BOOKING_FIELDS_EXTERNAL = ['clientName', 'serviceId', 'date', 'time']

export class ExternalUserStrategy implements IUserStrategy {
  readonly role: UserRole = 'external'

  requiresConfirmation(_state: ConversationState): boolean {
    return true
  }

  getRequiredBookingFields(): string[] {
    return BOOKING_FIELDS_EXTERNAL
  }

  canExecute(toolName: string): boolean {
    // External users can only interact with their own appointments
    const allowed = new Set([
      'confirm_booking',
      'reschedule_booking',
      'cancel_booking',
      'get_appointments_by_date',
      'get_services',
    ])
    return allowed.has(toolName)
  }

  buildCollectionPrompt(field: string, _draft: ConversationState['draft']): string {
    switch (field) {
      case 'clientName':
        return '¿A nombre de qué cliente está la cita?'
      case 'serviceId':
        return '¿Para qué servicio necesitas la cita?'
      case 'date':
        return '¿Para qué día necesitas la cita?'
      case 'time':
        return '¿A qué hora?'
      default:
        return `Necesito que me indiques: ${field}`
    }
  }

  buildConfirmationPrompt(draft: ConversationState['draft']): string {
    const service = draft?.serviceName ?? 'el servicio'
    const client = draft?.clientName ?? 'el cliente'
    const date = draft?.date ?? ''
    const time = draft?.time ?? ''

    let msg = `Confirmo: *${service}* para *${client}*`
    if (date && time) {
      msg += `, ${date} a las ${time}`
    }
    msg += '. ¿Confirmo?'
    return msg
  }
}

// ── OwnerStrategy (business owners via Web) ───────────────────────────────────

const BOOKING_FIELDS_OWNER = ['serviceId', 'date', 'time']

export class OwnerStrategy implements IUserStrategy {
  readonly role: UserRole = 'owner'

  requiresConfirmation(_state: ConversationState): boolean {
    return false
  }

  getRequiredBookingFields(): string[] {
    return BOOKING_FIELDS_OWNER
  }

  canExecute(_toolName: string): boolean {
    // Owners can do everything
    return true
  }

  buildCollectionPrompt(field: string, _draft: ConversationState['draft']): string {
    switch (field) {
      case 'serviceId':
        return '¿Para qué servicio agendamos?'
      case 'date':
        return '¿Para qué día?'
      case 'time':
        return '¿A qué hora?'
      default:
        return `Necesito que me indiques: ${field}`
    }
  }

  buildConfirmationPrompt(_draft: ConversationState['draft']): string {
    // Owners never see confirmation prompts
    return ''
  }
}

// ── EmployeeStrategy (staff via Web dashboard) ────────────────────────────────

const BOOKING_FIELDS_EMPLOYEE = ['clientName', 'serviceId', 'date', 'time']

export class EmployeeStrategy implements IUserStrategy {
  readonly role: UserRole = 'employee'

  requiresConfirmation(_state: ConversationState): boolean {
    return true
  }

  getRequiredBookingFields(): string[] {
    return BOOKING_FIELDS_EMPLOYEE
  }

  canExecute(toolName: string): boolean {
    // Employees can manage appointments and clients, but NOT finances
    const blocked = new Set([
      'get_revenue_stats',
      'get_monthly_forecast',
      'register_payment',
      'get_client_debt',
      'get_today_summary', // includes revenue
    ])
    return !blocked.has(toolName)
  }

  buildCollectionPrompt(field: string, _draft: ConversationState['draft']): string {
    switch (field) {
      case 'clientName':
        return '¿A nombre de qué cliente?'
      case 'serviceId':
        return '¿Para qué servicio?'
      case 'date':
        return '¿Para qué día?'
      case 'time':
        return '¿A qué hora?'
      default:
        return `Necesito que me indiques: ${field}`
    }
  }

  buildConfirmationPrompt(draft: ConversationState['draft']): string {
    const service = draft?.serviceName ?? 'el servicio'
    const client = draft?.clientName ?? 'el cliente'
    const date = draft?.date ?? ''
    const time = draft?.time ?? ''

    let msg = `Voy a agendar: *${service}* para *${client}*`
    if (date && time) {
      msg += `, ${date} a las ${time}`
    }
    msg += '. ¿Procedo?'
    return msg
  }
}

// ── Platform Admin Strategy ──────────────────────────────────────────────────

export class PlatformAdminStrategy implements IUserStrategy {
  readonly role: UserRole = 'platform_admin'

  requiresConfirmation(_state: ConversationState): boolean {
    return false
  }

  getRequiredBookingFields(): string[] {
    return BOOKING_FIELDS_OWNER
  }

  canExecute(_toolName: string): boolean {
    return true
  }

  buildCollectionPrompt(field: string, _draft: ConversationState['draft']): string {
    switch (field) {
      case 'serviceId':
        return '¿Para qué servicio?'
      case 'date':
        return '¿Para qué día?'
      case 'time':
        return '¿A qué hora?'
      default:
        return `Necesito que me indiques: ${field}`
    }
  }

  buildConfirmationPrompt(_draft: ConversationState['draft']): string {
    return ''
  }
}

// ── Strategy Factory ──────────────────────────────────────────────────────────

export class StrategyFactory {
  private static instance = new StrategyFactory()
  private strategies: Map<UserRole, IUserStrategy> = new Map()

  constructor() {
    this.strategies.set('external', new ExternalUserStrategy())
    this.strategies.set('owner', new OwnerStrategy())
    this.strategies.set('employee', new EmployeeStrategy())
    this.strategies.set('platform_admin', new PlatformAdminStrategy())
  }

  static forRole(role: UserRole): IUserStrategy {
    const strategy = this.instance.strategies.get(role)
    if (!strategy) {
      throw new Error(`No strategy registered for role: ${role}`)
    }
    return strategy
  }

  static register(role: UserRole, strategy: IUserStrategy): void {
    this.instance.strategies.set(role, strategy)
  }
}
