import { logger } from "@/lib/logger"

type ServiceName = 'STT' | 'LLM' | 'TTS'
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN'

/**
 * Custom Stateful Circuit Breaker for AI Services.
 * Trips (OPEN) after a threshold of failures to save latency and cost.
 */
class AICircuitBreaker {
  private states: Map<ServiceName, CircuitState> = new Map()
  private failures: Map<ServiceName, number> = new Map()
  private lastFails: Map<ServiceName, number> = new Map()
  
  private readonly threshold = 5 // Failures before tripping
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
    const lastFail = this.lastFails.get(service) || 0
    if (Date.now() - lastFail > this.cooldown) {
      this.states.set(service, 'HALF-OPEN')
      return true
    }

    return false
  }

  reportSuccess(service: ServiceName) {
    this.failures.set(service, 0)
    this.states.set(service, 'CLOSED')
  }

  reportFailure(service: ServiceName, error?: any) {
    // Rate limit (429) is transient — do not count as a real failure.
    // Tripping the circuit on 429 causes blackouts even when the service is healthy.
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error ?? '')
    if (errorStr.includes('rate_limit_exceeded') || errorStr.includes('"code":"rate_limit')) {
      logger.warn('CIRCUIT-BREAKER', `${service} rate limited — skipping failure count`)
      return
    }

    const currentFails = (this.failures.get(service) || 0) + 1
    this.failures.set(service, currentFails)
    this.lastFails.set(service, Date.now())

    if (currentFails >= this.threshold) {
      this.states.set(service, 'OPEN')
      logger.error('CIRCUIT-BREAKER', `Circuit for ${service} tripped (OPEN)`, error)
    }
  }

  getDiagnostic(): Record<ServiceName, CircuitState> {
    return Object.fromEntries(this.states.entries()) as Record<ServiceName, CircuitState>
  }
}

export const aiCircuit = new AICircuitBreaker()
