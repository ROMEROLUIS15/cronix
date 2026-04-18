/**
 * orchestrator-factory.ts — Assembles the production AiOrchestrator.
 *
 * Single entry point: call createProductionOrchestrator(supabase, groqApiKey)
 * once per request. Returns a fully wired AiOrchestrator with:
 *   - RedisStateManager (persistent conversation state)
 *   - DecisionEngine (unchanged)
 *   - ExecutionEngine + RealToolExecutor (real Supabase writes)
 *   - LlmBridge + GroqProvider (real LLM calls)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { AiOrchestrator }   from './ai-orchestrator'
import { DecisionEngine }   from './decision-engine'
import { ExecutionEngine }  from './execution-engine'
import { stateManager }     from './state-manager'
import { LlmBridge }        from './LlmBridge'
import { RealToolExecutor } from './tool-adapter/RealToolExecutor'
import { GroqProvider }     from '@/lib/ai/providers/groq-provider'
import { getRepos }         from '@/lib/repositories'
import { NotificationService } from '@/lib/notifications/notification-service'

export function createProductionOrchestrator(
  supabase: SupabaseClient<Database>,
  groqApiKey: string,
): AiOrchestrator {
  const repos = getRepos(supabase)

  return new AiOrchestrator(
    stateManager,
    new DecisionEngine(),
    new ExecutionEngine(
      new RealToolExecutor(
        repos.appointments, // IAppointmentQueryRepository
        repos.appointments, // IAppointmentCommandRepository (same class implements both)
        repos.clients,
        repos.services,
      ),
      new LlmBridge(new GroqProvider(groqApiKey)),
      new NotificationService(supabase),
    ),
  )
}
