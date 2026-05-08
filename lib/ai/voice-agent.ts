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

import { getRepos }              from '@/lib/repositories'
import { RealToolExecutor }      from '@/lib/ai/orchestrator/tool-adapter/RealToolExecutor'
import { NotificationService }   from '@/lib/notifications/notification-service'
import { emitEvent }             from '@/lib/ai/orchestrator/event-dispatcher'
import type { AppointmentEvent, AppointmentEventType, BookingEventData } from '@/lib/ai/orchestrator/events'
import { logger }                from '@/lib/logger'

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

REGLA CRÍTICA — UNA SOLA EJECUCIÓN POR ACCIÓN:
- Llama cada herramienta UNA SOLA VEZ por turno. NO la repitas con los mismos argumentos.
- Después de smart_schedule exitoso → responde "Listo. Agendé a X el [fecha] a las [hora]." y TERMINA.
- Después de cancel_booking exitoso → responde "Cancelado." y TERMINA.
- Si una herramienta devuelve éxito, NO la vuelvas a llamar. Sintetiza la respuesta y para.

FLUJO AGENDAR (4 PARÁMETROS OBLIGATORIOS): cliente + servicio + fecha + hora.
- Si FALTA cualquiera de los 4 → pregunta SOLO por ese dato faltante. Pregunta corta y directa, un dato a la vez. NO inventes valores. NO llames smart_schedule todavía.
- Ejemplos:
   • "Agéndame a María Pérez para el 24 de mayo" → faltan servicio + hora → pregunta primero "¿Para qué servicio?"
   • Cuando responda el servicio → si aún falta hora, pregunta "¿A qué hora?"
   • SOLO cuando tengas los 4 → smart_schedule(service_name, client_name, date, time) UNA SOLA VEZ.
- Después del éxito → "Listo. Agendé a [cliente] para [servicio] el [fecha] a las [hora]." y TERMINA.

FLUJO CANCELAR: confirma primero ("¿Cancelo la cita de X del [fecha]?") y espera "sí" → cancel_booking UNA vez → "Cancelado."

FLUJO REAGENDAR: necesitas cliente + nueva fecha + nueva hora. Si falta alguno, pregúntalo. Cuando estén → reschedule_booking UNA vez → "Reagendado para [fecha] a las [hora]."

CONSULTAS:
- CITAS DEL DÍA: get_appointments_by_date UNA vez. Formato: "HH:mm cliente — servicio" por línea. Si vacío: "No hay citas para ese día."
- TELÉFONO/CLIENTE: search_clients UNA vez y retransmite el número completo tal como aparece.`

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

// Maps the write tool name to the AppointmentEvent type emitted to the bell.
// create_client and delete_client are NOT here — those don't generate bell
// notifications today (no equivalent event type in events.ts).
const TOOL_TO_EVENT: Record<string, AppointmentEventType> = {
  smart_schedule:     'appointment.created',
  confirm_booking:    'appointment.created',
  cancel_booking:     'appointment.cancelled',
  reschedule_booking: 'appointment.rescheduled',
}

/**
 * Builds an AppointmentEvent from a successful write-tool's BookingEventData.
 * Mirrors the helper from execution-engine.ts so the bell + WhatsApp pipeline
 * fires exactly the same way after the rewrite.
 */
function buildAppointmentEvent(
  toolName: string,
  data:     BookingEventData,
  input:    VoiceAgentInput,
): AppointmentEvent {
  return {
    eventId:     crypto.randomUUID(),
    type:        TOOL_TO_EVENT[toolName] ?? 'appointment.created',
    businessId:  input.businessId,
    clientName:  data.clientName,
    serviceName: data.serviceName,
    date:        data.date,
    time:        data.time,
    userId:      input.userId,
    channel:     'web',
  }
}

/**
 * Wraps a RealToolExecutor call into an AI SDK tool execute function.
 * Returns the tool's text result so the LLM can synthesize the response.
 *
 * Two critical responsibilities beyond execution:
 *   1. Per-turn deduplication — blocks the LLM from calling the same write
 *      tool with the same args multiple times (root cause of the 6-duplicate-
 *      bookings bug seen in production).
 *   2. Bell notification dispatch — after a successful write tool, fires an
 *      AppointmentEvent fire-and-forget through NotificationService so the
 *      dashboard bell + WhatsApp owner notice both light up.
 */
function makeToolExecutor(
  executor:    RealToolExecutor,
  notifSvc:    NotificationService,
  input:       VoiceAgentInput,
  flags:       { actionPerformed: boolean },
) {
  const WRITE_TOOLS = new Set([
    'smart_schedule', 'confirm_booking', 'cancel_booking',
    'reschedule_booking', 'create_client', 'delete_client',
  ])
  // Fingerprints of tool calls already executed in THIS turn.
  // Same name + same args = exact duplicate → blocked to prevent loop bookings.
  const executedFingerprints = new Set<string>()

  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    // Stable fingerprint: tool name + canonical JSON of args (sorted keys).
    const sortedArgs = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k]
      return acc
    }, {})
    const fingerprint = `${toolName}::${JSON.stringify(sortedArgs)}`

    if (executedFingerprints.has(fingerprint)) {
      logger.warn('VOICE-AGENT', `Duplicate tool call blocked: ${toolName}`, {
        userId: input.userId,
        args:   sortedArgs,
      })
      return 'Esta acción ya fue ejecutada en este turno con los mismos datos. No la repitas. Responde al usuario con el resultado anterior.'
    }
    executedFingerprints.add(fingerprint)

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

      if (WRITE_TOOLS.has(toolName)) {
        flags.actionPerformed = true
        // Dispatch bell notification + WhatsApp notice if this tool produced
        // structured data (smart_schedule, cancel_booking, reschedule_booking).
        // Fire-and-forget — never blocks the response.
        if (result.data && TOOL_TO_EVENT[toolName]) {
          const event = buildAppointmentEvent(toolName, result.data, input)
          emitEvent(event, notifSvc)
        }
      }

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
  // Bell + WhatsApp owner notifications. Fired fire-and-forget after each
  // successful write tool — derivative, never blocks the response.
  const notifSvc = new NotificationService(supabase)

  const flags = { actionPerformed: false }
  const exec  = makeToolExecutor(executor, notifSvc, input, flags)
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
      // 3 steps max: enough for 1-2 tool calls + final synthesis.
      // Higher values risk runaway loops (smart_schedule called 6x in production).
      stopWhen:        stepCountIs(3),
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
