/**
 * tool-registry.ts — Dynamic registry core for AI Tools.
 *
 * SRP: manages the tool map, registration, and execution.
 * Tool definitions live in tool-definitions.ts (data layer).
 */

import type { ToolSchema, ToolParamProperty } from './providers/types'
import { readToolDefinitions } from './tool-definitions.read'
import { writeToolDefinitions } from './tool-definitions.write'

export interface ToolDefinition extends ToolSchema {
  handler: (businessId: string, args: Record<string, unknown>, timezone?: string) => Promise<string>
}

// Re-export for consumers that need the property type
export type { ToolParamProperty }

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  constructor() {
    for (const def of [...readToolDefinitions, ...writeToolDefinitions]) {
      this.register(def)
    }
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.function.name, tool)
  }

  getDefinitions(): ToolSchema[] {
    return Array.from(this.tools.values()).map(t => ({
      type: t.type,
      function: t.function,
    }))
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    businessId: string,
    timezone?: string,
  ): Promise<string> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool ${name} not found`)

    // Strip null/undefined — prevents schema validation errors downstream
    const sanitized: Record<string, unknown> = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== null && v !== undefined),
    )

    return tool.handler(businessId, sanitized, timezone)
  }
}

export const toolRegistry = new ToolRegistry()
