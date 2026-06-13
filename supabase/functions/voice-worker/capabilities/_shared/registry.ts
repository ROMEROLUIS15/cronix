/**
 * Central registry — the agent loop only knows this module and the ICapability
 * contract. Adding a new capability is one import + one array entry; nothing
 * else in voice-worker needs to change.
 */

import type { ICapability, ToolDefinition, FastPathInput } from './Capability.ts'
import type { ToolContext } from '../../core/tool-context.ts'
import type { ToolResult }  from '../../types.ts'

import { listAppointmentsCapability } from '../list-appointments/index.ts'
import { clientAppointmentsCapability } from '../client-appointments/index.ts'
import { nextAppointmentCapability }  from '../next-appointment/index.ts'
import { searchClientsCapability }    from '../search-clients/index.ts'
import { rescheduleCapability }       from '../reschedule/index.ts'
import { cancelCapability }           from '../cancel/index.ts'
import { scheduleCapability }         from '../schedule/index.ts'
import { deleteClientCapability }     from '../delete-client/index.ts'
import { lastVisitCapability }        from '../last-visit/index.ts'
import { getServicesCapability }      from '../get-services/index.ts'
import { createClientCapability }     from '../create-client/index.ts'
import { availableSlotsCapability }   from '../available-slots/index.ts'

// Order matters — earlier entries take priority. Reschedule and cancel before
// schedule because "reagenda" / "cancela y reagenda" share the verb-suffix
// space with "agenda" and would be misrouted otherwise. List before all so
// "qué citas tengo mañana" doesn't trigger schedule's date+time presence.
// deno-lint-ignore no-explicit-any
const CAPABILITIES: ICapability<any>[] = [
  // nextAppointment BEFORE listAppointments — "próxima cita" without a date
  // keyword must not fall into the day-listing path (which would return
  // today's 12:00 AM appointment as "next"). The detector here is strict:
  // singular "próxima/siguiente cita" with NO date keyword.
  nextAppointmentCapability,
  listAppointmentsCapability,
  // clientAppointments AFTER listAppointments — "citas de mañana" must stay
  // in the day-listing path (the detector rejects date-words as names, but
  // order keeps the date intent authoritative) and BEFORE the write
  // capabilities (its WRITE blocklist keeps "reagenda la cita de Ana" out).
  clientAppointmentsCapability,
  rescheduleCapability,
  cancelCapability,
  deleteClientCapability,
  scheduleCapability,
  lastVisitCapability,    // must precede searchClients: "última cita de X" would hit search's loose name regex
  searchClientsCapability,
  getServicesCapability,
  createClientCapability,
  availableSlotsCapability,
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

/**
 * Dispatcher used by both the LLM path and the fast path. Looks up the tool
 * by name, runs it, and wraps thrown exceptions in a uniform error ToolResult
 * so callers never see a bare reject.
 */
export async function executeByName(
  toolName: string,
  args:     Record<string, unknown>,
  ctx:      ToolContext,
): Promise<ToolResult> {
  const cap = byName.get(toolName)
  if (!cap) {
    return { success: false, result: `Tool desconocida: ${toolName}`, error: 'TOOL_NOT_FOUND' }
  }
  try {
    return await cap.execute(ctx, args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[VOICE-WORKER-REGISTRY] ${toolName} threw: ${msg}`)
    return { success: false, result: 'Error interno al ejecutar la acción.', error: msg }
  }
}
