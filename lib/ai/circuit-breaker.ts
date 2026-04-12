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
 */
class AICircuitBreaker {
  private states:    Map<ServiceName, CircuitState> = new Map()
  private failures:  Map<ServiceName, number>       = new Map()
  private lastFails: Map<ServiceName, number>       = new Map()

  private readonly threshold = 5             // Failures before tripping
  private readonly cooldown  = 5 * 60 * 1000 // 5 minutes open

  constructor() {
    this.states.set('STT', 'CLOSED')
    this.states.set('LLM', 'CLOSED')
    this.states.set('TTS', 'CLOSED')
  }

  isAvailable(service: ServiceName): boolean {
    const state = this.states.get(service)
    if (state === 'CLOSED') return true

    // If half-open or open, check cooldown
    const lastFail = this.lastFails.get(service) ?? 0
    if (Date.now() - lastFail > this.cooldown) {
      this.#transitionTo(service, 'HALF-OPEN')
      return true
    }

    return false
  }

  reportSuccess(service: ServiceName) {
    const previous = this.states.get(service)
    this.failures.set(service, 0)
    this.#transitionTo(service, 'CLOSED')

    // If recovering from OPEN/HALF-OPEN, log the recovery
    if (previous !== 'CLOSED') {
      logger.info('CIRCUIT-BREAKER', `Circuit for ${service} recovered (CLOSED)`, { previous })
      if (process.env.NODE_ENV === 'production') {
        Sentry.withScope((scope) => {
          scope.setTag('service', service)
          scope.setTag('circuit_event', 'recovered')
          scope.setLevel('info')
          scope.captureMessage(`[Circuit Breaker] ${service} recovered after outage`)
        })
      }
    }
  }

  reportFailure(service: ServiceName, error?: unknown) {
    // Rate limit (429) is transient — do not count as a real failure.
    // Tripping the circuit on 429 causes blackouts even when the service is healthy.
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error ?? '')
    if (errorStr.includes('rate_limit_exceeded') || errorStr.includes('"code":"rate_limit')) {
      logger.warn('CIRCUIT-BREAKER', `${service} rate limited — skipping failure count`)
      return
    }

    const currentFails = (this.failures.get(service) ?? 0) + 1
    this.failures.set(service, currentFails)
    this.lastFails.set(service, Date.now())

    if (currentFails >= this.threshold) {
      const previous = this.states.get(service)
      this.#transitionTo(service, 'OPEN')
      logger.error('CIRCUIT-BREAKER', `Circuit for ${service} tripped (OPEN)`, error)

      // Phase 4: Sentry alert on first trip (not on repeated failure in OPEN state)
      if (previous !== 'OPEN' && process.env.NODE_ENV === 'production') {
        Sentry.withScope((scope) => {
          scope.setTag('service', service)
          scope.setTag('circuit_event', 'tripped')
          scope.setTag('failures', String(currentFails))
          scope.setLevel('fatal')
          scope.captureException(
            error instanceof Error
              ? error
              : new Error(`[Circuit Breaker] ${service} tripped after ${currentFails} consecutive failures`)
          )
        })
      }
    }
  }

  getDiagnostic(): Record<ServiceName, CircuitState> {
    return Object.fromEntries(this.states.entries()) as Record<ServiceName, CircuitState>
  }

  /** Private: log every state transition for Axiom tracing */
  #transitionTo(service: ServiceName, next: CircuitState): void {
    const current = this.states.get(service)
    if (current === next) return
    this.states.set(service, next)
    logger.info('CIRCUIT-BREAKER', `${service}: ${current} → ${next}`, {
      failures: this.failures.get(service) ?? 0,
    })
  }
}

export const aiCircuit = new AICircuitBreaker()
