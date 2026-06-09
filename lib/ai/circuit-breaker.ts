import * as Sentry from '@sentry/nextjs'
import { logger } from "@/lib/logger"

type ServiceName = 'STT' | 'LLM' | 'TTS'
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN'

/**
 * Custom Stateful Circuit Breaker for AI Services.
 * Trips (OPEN) after a threshold of failures to save latency and cost.
 *
 * Phase 4: State transitions are reported to Sentry as issues so on-call
 * receives an alert the moment a provider goes down — not when users complain.
 *
 * Multi-tenant isolation: each businessId gets its own circuit state,
 * so one misbehaving tenant cannot DOS the AI service for all others.
 */
class AICircuitBreaker {
  private states:    Map<string, CircuitState> = new Map()
  private failures:  Map<string, number>       = new Map()
  private lastFails: Map<string, number>       = new Map()

  private readonly threshold = 5             // Failures before tripping
  private readonly cooldown  = 5 * 60 * 1000 // 5 minutes open

  readonly defaultTenant = 'global'

  #key(service: ServiceName, businessId: string): string {
    return `${businessId}:${service}`
  }

  isAvailable(service: ServiceName, businessId: string = this.defaultTenant): boolean {
    const k = this.#key(service, businessId)
    const state = this.states.get(k)

    // First access — auto-initialise
    if (state === undefined) {
      this.states.set(k, 'CLOSED')
      return true
    }

    if (state === 'CLOSED') return true

    // If half-open or open, check cooldown
    const lastFail = this.lastFails.get(k) ?? 0
    if (Date.now() - lastFail > this.cooldown) {
      this.#transitionTo(service, businessId, 'HALF-OPEN')
      return true
    }

    return false
  }

  reportSuccess(service: ServiceName, businessId: string = this.defaultTenant) {
    const k = this.#key(service, businessId)
    const previous = this.states.get(k)
    this.failures.set(k, 0)
    this.#transitionTo(service, businessId, 'CLOSED')

    // If recovering from OPEN/HALF-OPEN, log the recovery
    if (previous !== 'CLOSED') {
      logger.info('CIRCUIT-BREAKER', `Circuit for ${service} (${businessId}) recovered (CLOSED)`, { previous })
      if (process.env.NODE_ENV === 'production') {
        Sentry.withScope((scope) => {
          scope.setTag('service', service)
          scope.setTag('business_id', businessId)
          scope.setTag('circuit_event', 'recovered')
          scope.setLevel('info')
          scope.captureMessage(`[Circuit Breaker] ${service} (${businessId}) recovered after outage`)
        })
      }
    }
  }

  reportFailure(service: ServiceName, error?: unknown, businessId: string = this.defaultTenant) {
    const k = this.#key(service, businessId)

    // Rate limit (429) is transient — do not count as a real failure.
    // Tripping the circuit on 429 causes blackouts even when the service is healthy.
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error ?? '')
    if (errorStr.includes('rate_limit_exceeded') || errorStr.includes('"code":"rate_limit')) {
      logger.warn('CIRCUIT-BREAKER', `${service} (${businessId}) rate limited — skipping failure count`)
      return
    }

    const currentFails = (this.failures.get(k) ?? 0) + 1
    this.failures.set(k, currentFails)
    this.lastFails.set(k, Date.now())

    if (currentFails >= this.threshold) {
      const previous = this.states.get(k)
      this.#transitionTo(service, businessId, 'OPEN')
      logger.error('CIRCUIT-BREAKER', `Circuit for ${service} (${businessId}) tripped (OPEN)`, error)

      // Phase 4: Sentry alert on first trip (not on repeated failure in OPEN state)
      if (previous !== 'OPEN' && process.env.NODE_ENV === 'production') {
        Sentry.withScope((scope) => {
          scope.setTag('service', service)
          scope.setTag('business_id', businessId)
          scope.setTag('circuit_event', 'tripped')
          scope.setTag('failures', String(currentFails))
          scope.setLevel('fatal')
          scope.captureException(
            error instanceof Error
              ? error
              : new Error(`[Circuit Breaker] ${service} (${businessId}) tripped after ${currentFails} consecutive failures`)
          )
        })
      }
    }
  }

  getDiagnostic(): Record<string, CircuitState> {
    return Object.fromEntries(this.states.entries()) as Record<string, CircuitState>
  }

  /** Private: log every state transition for Axiom tracing */
  #transitionTo(service: ServiceName, businessId: string, next: CircuitState): void {
    const k = this.#key(service, businessId)
    const current = this.states.get(k)
    if (current === next) return
    this.states.set(k, next)
    logger.info('CIRCUIT-BREAKER', `${service} (${businessId}): ${current} → ${next}`, {
      failures: this.failures.get(k) ?? 0,
    })
  }
}

export const aiCircuit = new AICircuitBreaker()
