/**
 * Central registry — the agent loop only knows this module and the ICapability
 * contract. Adding a new capability is one import + one array entry; nothing
 * else in voice-worker needs to change.
 */

import type { ICapability, ToolDefinition, FastPathInput } from './Capability.ts'
import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'

import { listAppointmentsCapability } from '../list-appointments/index.ts'
import { searchClientsCapability }    from '../search-clients/index.ts'
import { rescheduleCapability }       from '../reschedule/index.ts'
import { cancelCapability }           from '../cancel/index.ts'

// Order matters — earlier entries take priority. Reschedule before cancel
// because "cancela y reagenda" could otherwise be hijacked by the cancel
// detector before the user finishes the sentence.
// deno-lint-ignore no-explicit-any
const CAPABILITIES: ICapability<any>[] = [
  listAppointmentsCapability,
  rescheduleCapability,
  cancelCapability,
  searchClientsCapability,
]

const byName = new Map(CAPABILITIES.map(c => [c.name, c]))

export function getToolDefinitions(): ToolDefinition[] {
  return CAPABILITIES.map(c => c.definition)
}

export function getCapability(name: string): ICapability | undefined {
  return byName.get(name)
}

export const WRITE_CAPABILITIES = new Set(
  CAPABILITIES.filter(c => c.isWrite).map(c => c.name),
)

export const BYPASS_CAPABILITIES = new Set(
  CAPABILITIES.filter(c => c.bypassLLM).map(c => c.name),
)

/**
 * Iterates capabilities and returns the first match. Order matters — earlier
 * entries take priority. For voice-worker we keep the order: read-list checks
 * before client lookups (so "última cita de X" doesn't fall into search), and
 * deterministic intents before fuzzy ones.
 */
export function detectFastPath(input: FastPathInput): {
  capability: ICapability
  args:       Record<string, unknown>
} | null {
  for (const cap of CAPABILITIES) {
    const args = cap.detectFastPath(input)
    if (args !== null) return { capability: cap, args }
  }
  return null
}

export async function executeByName(
  toolName: string,
  args:     Record<string, unknown>,
  ctx:      ToolContext,
): Promise<ToolResult | null> {
  const cap = byName.get(toolName)
  if (!cap) return null
  return cap.execute(ctx, args)
}
