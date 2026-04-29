/**
 * Dashboard agent — concrete implementation of IAgent.
 *
 * Wires together the three co-located files (prompt, tools, config) into
 * the single IAgent interface consumed by the DecisionEngine.
 * Nothing outside lib/ai/agents/dashboard/ should import from prompt.ts
 * or tools.ts directly — import `dashboardAgent` from here instead.
 */

import type { IAgent } from '../IAgent'
import { buildSystemPrompt }       from './prompt'
import { buildToolDefsForRole }    from './tools'
import { DASHBOARD_AGENT_CONFIG }  from './config'

export const dashboardAgent: IAgent = {
  buildSystemPrompt(input, state, resolved) {
    return buildSystemPrompt(input, state, resolved)
  },

  buildToolDefs(strategy, flow) {
    return buildToolDefsForRole(strategy, flow)
  },

  config: {
    maxReactIterations: DASHBOARD_AGENT_CONFIG.maxReactIterations,
    llmTier:            DASHBOARD_AGENT_CONFIG.llmTier,
  },
}
