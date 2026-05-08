/**
 * voice-agent.ts — Single-file dashboard voice assistant.
 *
 * Replaces the multi-layer orchestrator (DecisionEngine + ExecutionEngine +
 * IntentRouter + OutputShield + custom ReAct loop) with one Vercel AI SDK
 * `generateText` call that handles tool calling natively.
 *
 * Design goals:
 *   - One LLM call (multi-step internal via SDK), no custom ReAct.
 *   - Tools delegate to the existing RealToolExecutor (zero rewrite of business logic).
 *   - Cerebras `llama3.3-70b` primary (~1s), Groq 8B fallback (last resort).
 *   - No output shield, no intent router, no decision engine.
 *
 * Used by: app/api/assistant/voice/worker/route.ts
 * Does NOT touch: anything WhatsApp (supabase/functions/process-whatsapp/*).
 */

import { z }              from 'zod'
import { generateText, tool, stepCountIs } from 'ai'
import { createOpenAI }   from '@ai-sdk/openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

import { getRepos }         from '@/lib/repositories'
import { RealToolExecutor } from '@/lib/ai/orchestrator/tool-adapter/RealToolExecutor'
import { logger }           from '@/lib/logger'

// ── Providers ──────────────────────────────────────────────────────────────

const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY
const GROQ_KEY     = (process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)[0] ?? ''

const cerebras = CEREBRAS_KEY
  ? createOpenAI({ apiKey: CEREBRAS_KEY, baseURL: 'https://api.cerebras.ai/v1' })
  : null

const groq = GROQ_KEY
  ? createOpenAI({ apiKey: GROQ_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : null

// ── Types ──────────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'admin' | 'employee' | 'external'

export interface VoiceAgentInput {
  text:       string
  userId:     string
  businessId: string
  userName:   string
  userRole:   UserRole
  timezone:   string
  history:    Array<{ role: 'user' | 'assistant'; content: string }>
  context: {
    businessName:       string
    services:           Array<{ id: string; name: string; duration_min: number; price: number }>
    activeAppointments: Array<{ startAt: string; clientName: string; serviceName: string }>
    workingHours?:      Record<string, { open: string; close: string }>
    aiRules?:           string
  }
}

export interface VoiceAgentOutput {
  text:            string
  tokens:          number
  actionPerformed: boolean
  history:         Array<{ role: 'user' | 'assistant'; content: string }>
  modelUsed:       string
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(input: VoiceAgentInput): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: input.timezone })
  let p = `Eres "Luis", asistente de voz de "${input.context.businessName}". Responde en español, conversacional, máximo 1-2 oraciones (al listar, una línea por ítem).

HOY: ${today} (zona ${input.timezone})
Usuario: ${input.userName} (${input.userRole})

REGLAS:
- Si no llamaste a una herramienta, NO sabes el dato. No inventes.
- Pasa los nombres TAL CUAL los dijo el usuario; las herramientas hacen fuzzy match.
- Sin markdown, sin emojis, sin URLs, sin IDs ni JSON.
- Fechas YYYY-MM-DD. Horas HH:mm 24h. Convierte "mañana" / "3pm" antes de llamar herramientas.
- Para AGENDAR: cuando tengas servicio + cliente + fecha + hora → smart_schedule directamente.
- Para CANCELAR: confirma primero ("¿Cancelo la cita de X?") y espera "sí" antes de cancel_booking.
- CITAS DEL DÍA formato: "HH:mm cliente — servicio" por línea. Si vacío: "No hay citas para ese día."
- Si pides el teléfono de un cliente, llama search_clients y retransmite el número completo.`

  if (input.context.services.length > 0) {
    p += '\n\nSERVICIOS DISPONIBLES: ' + input.context.services
      .map(s => `${s.name} (${s.duration_min}min)`)
      .join(', ')
  } else {
    p += '\n\nSERVICIOS: Ninguno configurado. Si piden agendar, di que primero deben crearse en Configuración.'
  }

  if (input.context.activeAppointments.length > 0) {
    p += '\n\nCITAS DE HOY (referencia rápida, prefiere herramientas para datos exactos):'
    for (const a of input.context.activeAppointments.slice(0, 5)) {
      p += `\n- ${a.startAt.slice(11, 16)} ${a.clientName} (${a.serviceName})`
    }
  }

  if (input.context.workingHours) {
    const days: Record<string, string> = {
      monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié',
      thursday: 'Jue', friday: 'Vie', saturday: 'Sáb', sunday: 'Dom',
    }
    const parts: string[] = []
    for (const [day, hours] of Object.entries(input.context.workingHours)) {
      const label = days[day] ?? day
      if (hours?.open && hours?.close) parts.push(`${label} ${hours.open}-${hours.close}`)
    }
    if (parts.length) p += `\n\nHORARIO: ${parts.join(' | ')}`
  }

  if (input.context.aiRules) {
    p += `\n\nREGLAS DEL NEGOCIO: ${input.context.aiRules}`
  }

  return p
}

// ── Tool factory ───────────────────────────────────────────────────────────

/**
 * Wraps a RealToolExecutor call into an AI SDK tool execute function.
 * Returns the tool's text result so the LLM can synthesize the response.
 */
function makeToolExecutor(
  executor: RealToolExecutor,
  input:    VoiceAgentInput,
  flags:    { actionPerformed: boolean },
) {
  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    const t0 = Date.now()
    try {
      const result = await executor.execute({
        toolName,
        args,
        businessId:   input.businessId,
        userId:       input.userId,
        timezone:     input.timezone,
        workingHours: input.context.workingHours,
      })
      logger.info('VOICE-AGENT', `Tool ${toolName}`, {
        ok:       result.success,
        duration: Date.now() - t0,
      })
      if (!result.success) return `Error: ${result.error ?? result.result}`
      // Track if a write tool succeeded
      const writeTools = new Set(['smart_schedule', 'confirm_booking', 'cancel_booking', 'reschedule_booking', 'create_client', 'delete_client'])
      if (writeTools.has(toolName)) flags.actionPerformed = true
      return result.result
    } catch (err) {
      logger.error('VOICE-AGENT', `Tool ${toolName} threw`, { err: err instanceof Error ? err.message : String(err) })
      return 'Error interno al ejecutar la acción.'
    }
  }
}

function buildTools(execute: (n: string, a: Record<string, unknown>) => Promise<string>) {
  return {
    smart_schedule: tool({
      description: 'Agenda una cita en un solo paso. Úsala SIEMPRE para agendar cuando tengas servicio, cliente, fecha y hora. NO llames search_clients ni get_available_slots antes — esta herramienta los maneja internamente.',
      inputSchema: z.object({
        service_name: z.string().describe('Nombre del servicio tal como lo dijo el usuario'),
        client_name:  z.string().describe('Nombre del cliente tal como lo dijo el usuario'),
        date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
        time:         z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm 24h'),
      }),
      execute: (args) => execute('smart_schedule', args),
    }),

    cancel_booking: tool({
      description: 'Cancela una cita. Pasa client_name (y opcionalmente date/time para desambiguar).',
      inputSchema: z.object({
        client_name: z.string(),
        date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        time:        z.string().regex(/^\d{2}:\d{2}$/).optional(),
      }),
      execute: (args) => execute('cancel_booking', args),
    }),

    reschedule_booking: tool({
      description: 'Reagenda una cita existente a una nueva fecha/hora.',
      inputSchema: z.object({
        client_name: z.string(),
        date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        time:        z.string().regex(/^\d{2}:\d{2}$/).optional(),
        new_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        new_time:    z.string().regex(/^\d{2}:\d{2}$/),
      }),
      execute: (args) => execute('reschedule_booking', args),
    }),

    get_appointments_by_date: tool({
      description: 'Lista citas de un día específico. Devuelve formato "HH:mm cliente — servicio" por línea.',
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
      }),
      execute: (args) => execute('get_appointments_by_date', args),
    }),

    search_clients: tool({
      description: 'Busca un cliente por nombre. Devuelve nombre y teléfono. Tolera transcripciones imperfectas (fuzzy match).',
      inputSchema: z.object({
        query: z.string().min(2).describe('Nombre o parte del nombre'),
      }),
      execute: (args) => execute('search_clients', args),
    }),

    get_services: tool({
      description: 'Lista los servicios del negocio.',
      inputSchema: z.object({}),
      execute: (args) => execute('get_services', args),
    }),

    create_client: tool({
      description: 'Registra un cliente nuevo. Usa solo cuando el usuario pida explícitamente registrar a alguien.',
      inputSchema: z.object({
        name:  z.string().min(1).max(120),
        phone: z.string().max(30).optional(),
      }),
      execute: (args) => execute('create_client', args),
    }),

    delete_client: tool({
      description: 'Elimina un cliente. Falla si tiene citas futuras (cancélalas primero).',
      inputSchema: z.object({
        client_name: z.string(),
      }),
      execute: (args) => execute('delete_client', args),
    }),

    get_available_slots: tool({
      description: 'Consulta horarios libres para una fecha y duración (en minutos).',
      inputSchema: z.object({
        date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        duration_min: z.number().int().min(5).max(480),
      }),
      execute: (args) => execute('get_available_slots', args),
    }),
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function runVoiceAgent(
  supabase: SupabaseClient<Database>,
  input:    VoiceAgentInput,
): Promise<VoiceAgentOutput> {
  if (!cerebras && !groq) {
    throw new Error('No LLM provider configured (set CEREBRAS_API_KEY or LLM_API_KEY)')
  }

  const repos    = getRepos(supabase)
  const executor = new RealToolExecutor(
    repos.appointments,
    repos.appointments,
    repos.clients,
    repos.services,
  )

  const flags = { actionPerformed: false }
  const exec  = makeToolExecutor(executor, input, flags)
  const tools = buildTools(exec)

  const system   = buildSystemPrompt(input)
  const messages = [
    ...input.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: input.text },
  ]

  // Try Cerebras 70B first (fast + accurate). Fallback to Groq 8B on failure.
  const attempt = async (provider: 'cerebras' | 'groq') => {
    const model = provider === 'cerebras'
      ? cerebras!('llama3.3-70b')
      : groq!('llama-3.1-8b-instant')
    return generateText({
      model,
      system,
      messages,
      tools,
      stopWhen:        stepCountIs(4),
      temperature:     0.1,
      maxOutputTokens: 400,
    })
  }

  let result
  let modelUsed = 'unknown'
  try {
    if (cerebras) {
      result    = await attempt('cerebras')
      modelUsed = 'cerebras/llama3.3-70b'
    } else {
      result    = await attempt('groq')
      modelUsed = 'groq/llama-3.1-8b-instant'
    }
  } catch (err) {
    logger.warn('VOICE-AGENT', 'Primary provider failed — falling back', {
      err: err instanceof Error ? err.message : String(err),
    })
    if (!groq) throw err
    result    = await attempt('groq')
    modelUsed = 'groq/llama-3.1-8b-instant (fallback)'
  }

  const text = result.text?.trim()
    || (flags.actionPerformed ? 'Listo.' : 'No te entendí bien, ¿puedes repetir?')

  const newHistory = [
    ...input.history,
    { role: 'user'      as const, content: input.text },
    { role: 'assistant' as const, content: text },
  ].slice(-30) // keep last 30 turns

  return {
    text,
    tokens:          result.usage?.totalTokens ?? 0,
    actionPerformed: flags.actionPerformed,
    history:         newHistory,
    modelUsed,
  }
}
