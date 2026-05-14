/**
 * Agent loop — provider-agnostic.
 *
 * Manual implementation of the OpenAI-compatible tool-calling protocol:
 *   1. Send messages + tool defs to LLM (via the configured provider)
 *   2. If response has tool_calls, execute each, append tool messages
 *   3. Loop until LLM returns plain text (or MAX_STEPS exhausted)
 *
 * Per-turn deduplication: same (toolName + args) blocked. Prevents
 * duplicate bookings if the model loops on the same tool call.
 *
 * Provider selection is env-driven (LLM_PROVIDER):
 *   "groq"        → Groq only (default)
 *   "gemini"      → Gemini only
 *   "gemini,groq" → Gemini primary, Groq fallback on error
 *
 * Required env vars (depending on selection):
 *   LLM_API_KEY     — Groq (comma-separated for key rotation)
 *   GEMINI_API_KEY  — Gemini
 */

import { buildSystemPrompt }                          from './prompt.ts'
import { TOOL_DEFINITIONS, WRITE_TOOLS, executeTool, type ToolContext } from './tools.ts'
import { getProvider }                                from './providers/registry.ts'
import type { NeutralMessage, NeutralTool } from './providers/ILLMProvider.ts'
import type { AgentInput, AgentOutput, AppointmentNotification, NotificationType } from './types.ts'

const MAX_STEPS = 3   // 1-2 tool calls + final synthesis fits comfortably

/**
 * Tools whose result is already user-facing prose. When the LLM calls one of
 * these (and only one) and it succeeds, we bypass the second-pass LLM synthesis
 * and use the tool's `result` as the final response.
 *
 * Why: production logs showed Llama 3.3 70B Versatile occasionally ignoring
 * tool results and synthesizing its own (wrong) answer — e.g. "no hay citas"
 * when the tool returned 4 appointments. Bypassing the second LLM call on
 * single-tool success eliminates that hallucination surface entirely. This
 * mirrors the WhatsApp pattern (process-whatsapp/ai-agent.ts) which uses
 * deterministic templates for write-tool successes.
 *
 * It is INDUSTRY STANDARD for production agentic systems (LangChain
 * `return_direct=True`, OpenAI's function-calling docs, Anthropic's tool_use
 * best practices). The trade-off is slightly less conversational prose in
 * exchange for guaranteed correctness — for an MVP business assistant,
 * correctness is non-negotiable.
 *
 * NOT in this set: smart_schedule, cancel_booking, reschedule_booking
 *   (those write tools already return user-facing prose AND we want potential
 *    LLM rephrasing for confirmation context — but their templates are
 *    already deterministic so they rarely need synthesis either).
 */
const BYPASS_TOOLS = new Set([
  'get_appointments_by_date',
  'search_clients',
  'get_services',
  'get_available_slots',
  // Write tools also pass-through cleanly because their result strings
  // ("Listo. Agendé a X...") are already well-formed user-facing text.
  'smart_schedule',
  'cancel_booking',
  'reschedule_booking',
  'create_client',
  'delete_client',
  'check_duplicate_clients',
])

// ── Adapters: voice-worker types → neutral provider types ────────────────

/**
 * The TOOL_DEFINITIONS in tools.ts already match the neutral schema shape.
 * This adapter is a structural cast so downstream changes to NeutralTool
 * remain a single point of breakage instead of being scattered.
 */
function toNeutralTools(): NeutralTool[] {
  return TOOL_DEFINITIONS.map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters as NeutralTool['parameters'],
  }))
}

// ── Date guard (deterministic override of LLM date arithmetic) ───────────
//
// Llama 3.3 70B Versatile — even with extremely explicit imperative prompts
// listing "MAÑANA: <date>" — sometimes still passes today's date when the
// user says "mañana". This is a documented model weakness in numeric
// reasoning that prompt engineering can't fully eliminate.
//
// Solution: trust the model for INTENT (which tool to call, who to mention)
// but override its DATE selection with deterministic logic when we detect
// known temporal keywords in the user input. The LLM proposes, our code
// disposes.

/** Tools whose args include a `date: YYYY-MM-DD` field we can guard. */
const DATE_TOOLS = new Set([
  'get_appointments_by_date',
  'get_available_slots',
  'smart_schedule',
  'cancel_booking',
  'reschedule_booking',
])

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

interface DateOverride {
  date:    string
  reason:  string
}

/**
 * Inspects the user's text for temporal keywords ("hoy", "mañana", "pasado
 * mañana") and returns the canonical date. Order matters: "pasado mañana"
 * must be checked BEFORE "mañana" because the latter is a substring of
 * the former.
 *
 * Returns null when no recognized keyword is present (LLM keeps its date).
 */
function detectTemporalIntent(userText: string, today: string): DateOverride | null {
  const t = userText.toLowerCase()
  // Word-boundary regexes so "Manaña" inside another word doesn't trigger.
  const PASADO_MANANA = /\bpasado\s+ma[ñn]ana\b/
  const MANANA        = /\bma[ñn]ana\b/
  const HOY           = /\bhoy\b/

  if (PASADO_MANANA.test(t)) return { date: addDaysIso(today, 2), reason: '"pasado mañana"' }
  if (MANANA.test(t))        return { date: addDaysIso(today, 1), reason: '"mañana"' }
  if (HOY.test(t))           return { date: today,                reason: '"hoy"' }
  return null
}

// ── Fast path — total LLM bypass for simple appointment-list queries ─────
//
// Same deterministic philosophy as the junction-table fix earlier: when the
// user's intent is unambiguous from the input text alone, we don't need
// the LLM at all. Call the tool directly with the right date, return the
// tool's user-facing result. Zero room for the LLM to mess up.
//
// Triggers ONLY on the canonical read-list patterns. Anything ambiguous,
// any write operation, any complex query — falls through to the normal
// LLM flow unchanged. This is purely additive; nothing existing breaks.

/** Detects "qué citas tengo {hoy|mañana|pasado mañana}" — read-list intent only. */
function detectAppointmentListFastPath(
  userText: string,
  today: string,
): { date: string; reason: string } | null {
  const t = userText.toLowerCase()

  // Reject if any write keyword is present — fast path is read-only.
  //
  // "agenda" is ambiguous: SUSTANTIVO (= calendar) vs VERBO conjugation. We
  // only want to block the verb. The lookahead on agend(...) requires an
  // unambiguously verbal suffix: -ar, -ame, -alo, -aste, -aron, -ado, etc.
  // Bare "agenda" (e.g. "agenda de hoy") is left through to QUERY.
  const WRITE_AGENDAR = /\bag[eé]nd(?:a(?:r|me|lo|la|los|las|nos|ste|mos|ron)|[oé]|aremos|amos|emos|ar[ée]|ad[oa])\b/
  const WRITE_OTHERS  = /\b(reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé]|cre[aoeé]\s+un|nuev[ao]\s+cliente|registr[aoeé]|añad[aoeé]|agreg[aoeé])\b/
  if (WRITE_AGENDAR.test(t) || WRITE_OTHERS.test(t)) return null

  // Must look like a query about appointments (not generic chitchat).
  // Accepts: "qué citas tengo X", "citas de X", "agenda de X", "qué tengo X",
  // "muéstrame las citas X", "cuáles son mis citas X"
  const QUERY = /(\bqu[eé]\s+citas?\b|\bcitas\s+(de|hay|tengo|para|del|que)\b|\bagenda\b|\bmis?\s+citas\b|\bqu[eé]\s+tengo\b|\bcu[aá]les\s+son\s+mis?\s+citas\b|\bmu[eé]strame\b)/
  if (!QUERY.test(t)) return null

  // Detect target date keyword. Order matters: "pasado mañana" before "mañana".
  if (/\bpasado\s+ma[ñn]ana\b/.test(t)) return { date: addDaysIso(today, 2), reason: 'pasado mañana' }
  if (/\bma[ñn]ana\b/.test(t))          return { date: addDaysIso(today, 1), reason: 'mañana' }
  if (/\bhoy\b/.test(t))                return { date: today,                reason: 'hoy' }

  return null
}

/**
 * Detects "tengo (a/al/la/el) cliente X" / "busca a X" / "existe X" / "tienes a X"
 * patterns and extracts the client name. Returns null when not a client lookup.
 *
 * Like detectAppointmentListFastPath, this lets us call search_clients
 * deterministically without involving the LLM. Eliminates the case where the
 * LLM might emit instructional text or fail to invoke the tool.
 */
function detectClientLookupFastPath(userText: string): { name: string } | null {
  const t = userText.toLowerCase().trim()

  // Reject write intents — fast path is read-only.
  const WRITE_AGENDAR = /\bag[eé]nd(?:a(?:r|me|lo|la|los|las|nos|ste|mos|ron)|[oé]|aremos|amos|emos|ar[ée]|ad[oa])\b/
  const WRITE_OTHERS  = /\b(reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé]|cre[aoeé]\s+un|nuev[ao]\s+cliente|registr[aoeé]|añad[aoeé]|agreg[aoeé])\b/
  if (WRITE_AGENDAR.test(t) || WRITE_OTHERS.test(t)) return null

  // Words that look like names but aren't — defense against false positives
  // (e.g. "tengo mañana" → captured "mañana" as if it were a name).
  const NOT_A_NAME = new Set([
    'hoy', 'mañana', 'manana', 'ayer', 'anteayer', 'pasado',
    'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
    'cita', 'citas', 'agenda', 'algo', 'nada', 'tiempo', 'rato',
    'algún', 'algun', 'alguna', 'alguien',
  ])

  // Patterns that ask about a client by name. Each captures the name segment.
  // Order matters slightly — most specific first.
  // The optional `alg[uú]n[oa]?\s+` group inside the prefix handles "algún cliente"
  // even with the accent on "ú" (Speech-to-text often emits the accented form).
  const PATTERNS: RegExp[] = [
    // "tengo (a la|al|a) cliente X" / "tengo (a) X (entre mis clientes)?"
    /\btengo\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
    // "tienes (a) X" — informal you-form
    /\btienes\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
    // "existe (el|la) cliente X" / "existe X"
    /\bexist[ea]\s+(?:el|la)?\s*(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
    // "busca (a) X" / "buscame (a) X" / "encuentra (a) X"
    /\b(?:busca(?:me)?|encuentra|encu[eé]ntrame)\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
    // "hay (algún|alguna|un|una) cliente (llamad[oa]) X" / "hay alguien llamado X"
    /\bhay\s+(?:alg[uú]n[oa]?\s+|un[ao]?\s+)?(?:client[ea]\s+)?(?:llamad[oa]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+(?:entre|en|como|de)\s|\s*\?|\s*$)/i,
    // "cuál es el teléfono de X" / "qué teléfono tiene X"
    /\b(?:cu[aá]l\s+es\s+el\s+tel[eé]fono\s+de|qu[eé]\s+tel[eé]fono\s+tiene|tel[eé]fono\s+de)\s+(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  ]

  for (const re of PATTERNS) {
    const m = t.match(re)
    if (m && m[1]) {
      const name = m[1].trim()
        // Strip trailing punctuation
        .replace(/[.,;:!?]+$/, '')
        .trim()
      // Need at least 2 chars and not look like noise
      if (name.length < 2 || !/[a-záéíóúñ]/i.test(name)) continue

      // Reject if every word in the captured "name" is a non-name token
      // (temporal keyword, generic word, etc.). Protects against false
      // positives like "tengo mañana?" → captured "mañana".
      const words = name.split(/\s+/)
      const allNoise = words.every(w => NOT_A_NAME.has(w.toLowerCase()))
      if (allNoise) continue

      return { name }
    }
  }

  return null
}

/**
 * Detects "last visit" queries — "cuándo fue la última vez que atendí a X",
 * "qué día fue la última cita de X", "última visita de X", etc.
 *
 * Returns { client_name } if matched, null otherwise. Same defensive pattern
 * as detectClientLookupFastPath: rejects write verbs and noise-only captures.
 */
function detectLastVisitFastPath(userText: string): { client_name: string } | null {
  const t = userText.toLowerCase().trim()

  const WRITE = /\b(ag[eé]nd[aoeé]|reagend|reprogram[aoeé]|cancel[aoeé]|borr[aoeé]|elimin[aoeé])\b/
  if (WRITE.test(t)) return null

  const NOT_A_NAME = new Set([
    'hoy', 'mañana', 'manana', 'ayer', 'anteayer',
    'cita', 'citas', 'algo', 'nada', 'algún', 'algun', 'alguien',
  ])

  // "última vez que atendí/se atendió/vino/asistió X"
  // "última cita/visita de X"
  // "cuándo vino X por última vez"
  // "qué día fue la última vez (que) atendí X"
  // "dime cuándo vino X" / "dime la última visita de X"
  //
  // Note: `\b` only recognises ASCII word chars in JS regex, so any pattern
  // starting with an accented letter (like "última") must use `(?:^|\s)` as
  // an anchor instead — `\b[uú]ltima` would never match in real input.
  const PATTERNS: RegExp[] = [
    /(?:^|\s)[uú]ltima\s+vez\s+que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]|fue\s+atendid[oa])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
    /(?:^|\s)[uú]ltima\s+(?:cita|visita)\s+(?:de|para|que\s+tuvo)\s+(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
    /\bcu[aá]ndo\s+(?:vino|fue\s+atendid[oa]|asisti[óo]|atend[ií])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s+por\s+[uú]ltima\s+vez)?(?:\s*\?|\s*$)/i,
    /\bqu[eé]\s+d[ií]a\s+(?:fue\s+)?(?:la\s+)?[uú]ltima\s+vez\s+que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]|fue\s+atendid[oa])\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
    /\bdime\s+(?:la\s+[uú]ltima\s+(?:vez|cita|visita)\s+(?:que\s+(?:se\s+)?(?:atend[ií](?:[óoaá]|\s+a)?|vino|asisti[óo]))?|cu[aá]ndo\s+(?:vino|atend[ií]|asisti[óo]|fue\s+atendid[oa]))\s+(?:al?\s+)?(?:la\s+)?(?:client[ea]\s+)?([a-záéíóúñ][a-záéíóúñ\s.'-]{1,80}?)(?:\s*\?|\s*$)/i,
  ]

  for (const re of PATTERNS) {
    const m = t.match(re)
    if (m && m[1]) {
      const name = m[1].trim().replace(/[.,;:!?]+$/, '').trim()
      if (name.length < 2 || !/[a-záéíóúñ]/i.test(name)) continue
      const words = name.split(/\s+/)
      if (words.every(w => NOT_A_NAME.has(w.toLowerCase()))) continue
      return { client_name: name }
    }
  }

  return null
}

// ── Notification building (post-write side effect) ───────────────────────

const ACTION_TO_EVENT_TYPE: Record<string, NotificationType> = {
  created:     'appointment.created',
  cancelled:   'appointment.cancelled',
  rescheduled: 'appointment.rescheduled',
}

// ── Public API ────────────────────────────────────────────────────────────

export async function runAgent(
  ctx:   ToolContext,
  input: AgentInput,
): Promise<AgentOutput> {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })

  // ── FAST PATHS — total LLM bypass for unambiguous read queries
  //
  // The user's input text is unambiguous enough that we can answer correctly
  // without involving the LLM. Eliminates every class of LLM-induced bug:
  // wrong date math, hallucinated tool args, ignored tool results, looping.
  //
  // Same philosophy as the junction-table SQL fix earlier: when the answer
  // is computable deterministically, compute it. Don't roll the dice.

  // Fast path 1: appointment list ("qué citas tengo mañana")
  const fastPathDate = detectAppointmentListFastPath(input.text, todayLocal)
  if (fastPathDate) {
    console.log(`[VOICE-WORKER-AGENT] FAST PATH (appointments): date=${fastPathDate.date} (user said "${fastPathDate.reason}")`)
    const result = await executeTool('get_appointments_by_date', { date: fastPathDate.date }, ctx)
    const text = result.success
      ? result.result
      : 'No pude consultar las citas en este momento. Intenta de nuevo en un momento.'
    const newHistory: AgentOutput['history'] = [
      ...input.history,
      { role: 'user',      content: input.text },
      { role: 'assistant', content: text       },
    ].slice(-30)
    return {
      text,
      actionPerformed:      false,
      history:              newHistory,
      modelUsed:            'fast-path/appointments',
      pendingNotifications: [],
    }
  }

  // Fast path 3: last visit ("cuándo fue la última vez que atendí a Ada Monsalve")
  // Checked BEFORE client-lookup because "última vez que atendí a X" would also
  // match the loose "X" capture in the client-lookup patterns otherwise.
  const fastPathLastVisit = detectLastVisitFastPath(input.text)
  if (fastPathLastVisit) {
    console.log(`[VOICE-WORKER-AGENT] FAST PATH (last visit): client="${fastPathLastVisit.client_name}"`)
    const result = await executeTool('get_last_visit', { client_name: fastPathLastVisit.client_name }, ctx)
    const text = result.success
      ? result.result
      : 'No pude consultar la última visita en este momento. Intenta de nuevo.'
    const newHistory: AgentOutput['history'] = [
      ...input.history,
      { role: 'user',      content: input.text },
      { role: 'assistant', content: text       },
    ].slice(-30)
    return {
      text,
      actionPerformed:      false,
      history:              newHistory,
      modelUsed:            'fast-path/last-visit',
      pendingNotifications: [],
    }
  }

  // Fast path 2: client lookup ("tengo a María Dugarte?", "busca a Ada Monsalve")
  const fastPathClient = detectClientLookupFastPath(input.text)
  if (fastPathClient) {
    console.log(`[VOICE-WORKER-AGENT] FAST PATH (client lookup): name="${fastPathClient.name}"`)
    const result = await executeTool('search_clients', { query: fastPathClient.name }, ctx)
    const text = result.success
      ? result.result
      : 'No pude consultar la lista de clientes en este momento. Intenta de nuevo.'
    const newHistory: AgentOutput['history'] = [
      ...input.history,
      { role: 'user',      content: input.text },
      { role: 'assistant', content: text       },
    ].slice(-30)
    return {
      text,
      actionPerformed:      false,
      history:              newHistory,
      modelUsed:            'fast-path/client-lookup',
      pendingNotifications: [],
    }
  }

  // ── Normal LLM flow (everything else) ─────────────────────────────────
  const provider = getProvider()
  const tools    = toNeutralTools()
  const system   = buildSystemPrompt(input)

  // Pre-compute the user's temporal intent ONCE for this turn. If the user
  // said "hoy" / "mañana" / "pasado mañana", we'll use this to override the
  // LLM's date selection on any tool call that takes a `date` arg.
  const dateOverride    = detectTemporalIntent(input.text, todayLocal)

  // Conversation history → neutral messages
  const messages: NeutralMessage[] = [
    ...input.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: input.text },
  ]

  // Per-turn dedup of (toolName + canonical args JSON)
  const executedFingerprints = new Set<string>()
  let actionPerformed         = false
  const pendingNotifications: AppointmentNotification[] = []
  let modelUsed               = 'unknown'
  let finalText               = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await provider.chat({
      system,
      messages,
      tools,
      temperature:     0.1,
      maxOutputTokens: 400,
    })
    modelUsed = resp.modelUsed

    // No tool calls → final response
    if (resp.toolCalls.length === 0) {
      finalText = (resp.content ?? '').trim()
      messages.push({ role: 'assistant', content: finalText })
      break
    }

    // Append the assistant turn (with tool_calls) — required by the protocol
    messages.push({
      role:       'assistant',
      content:    resp.content,
      tool_calls: resp.toolCalls,
    })

    // Track results from this step so we can decide whether to bypass synthesis
    let lastSuccessfulText: string | null = null
    let successfulCallCount = 0

    // Execute each tool call
    for (const tc of resp.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>
      } catch {
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Error: argumentos inválidos (no es JSON válido).',
        })
        continue
      }

      // ── Date guard ─────────────────────────────────────────────────────
      // If the user said "hoy" / "mañana" / "pasado mañana" but the LLM
      // emitted a different `date`, override it. This is the only way to
      // make the assistant's date math reliable on Llama 3.x — the prompt
      // alone doesn't bind it strongly enough.
      if (dateOverride && DATE_TOOLS.has(tc.name) && typeof parsedArgs.date === 'string') {
        const llmDate = parsedArgs.date as string
        if (llmDate !== dateOverride.date) {
          console.warn(
            `[VOICE-WORKER-AGENT] Date guard: user said ${dateOverride.reason} ` +
            `but LLM passed date=${llmDate} → overriding to ${dateOverride.date}`,
          )
          parsedArgs.date = dateOverride.date
        }
      }

      // Stable fingerprint with sorted keys
      const sortedArgs = Object.keys(parsedArgs).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = parsedArgs[k]; return acc
      }, {})
      const fp = `${tc.name}::${JSON.stringify(sortedArgs)}`

      if (executedFingerprints.has(fp)) {
        console.warn(`[VOICE-WORKER-AGENT] Duplicate tool call blocked: ${tc.name}`)
        messages.push({
          role:         'tool',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      'Esta acción ya fue ejecutada en este turno con los mismos datos. NO la repitas. Sintetiza el resultado anterior y termina.',
        })
        continue
      }
      executedFingerprints.add(fp)

      const result = await executeTool(tc.name, parsedArgs, ctx)
      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        name:         tc.name,
        content:      result.result,
      })

      if (result.success) {
        successfulCallCount++
        lastSuccessfulText = result.result
      }

      if (result.success && WRITE_TOOLS.has(tc.name)) {
        actionPerformed = true
        if (result.data) {
          const eventType = ACTION_TO_EVENT_TYPE[result.data.action]
          if (eventType) {
            pendingNotifications.push({
              eventId:     crypto.randomUUID(),
              type:        eventType,
              businessId:  ctx.businessId,
              userId:      ctx.userId,
              clientName:  result.data.clientName,
              serviceName: result.data.serviceName,
              date:        result.data.date,
              time:        result.data.time,
            })
          }
        }
      }
    }

    // ── Bypass LLM synthesis when a single tool call succeeded ─────────────
    // Industry-standard pattern (LangChain `return_direct`, OpenAI function-
    // calling docs, Anthropic tool_use best practices): use the tool's output
    // directly instead of asking the LLM to "rephrase" it. Eliminates the
    // hallucination surface where 70B Versatile would otherwise sometimes
    // ignore the tool result and synthesize wrong answers.
    //
    // Conditions:
    //   - exactly ONE tool call this step (multi-tool needs synthesis)
    //   - exactly ONE successful (failed calls need LLM to handle gracefully)
    //   - the tool is in BYPASS_TOOLS (explicit allow-list, defensive)
    if (
      resp.toolCalls.length === 1 &&
      successfulCallCount === 1 &&
      lastSuccessfulText &&
      BYPASS_TOOLS.has(resp.toolCalls[0]!.name)
    ) {
      finalText = lastSuccessfulText
      console.log(`[VOICE-WORKER-AGENT] Bypassing LLM synthesis — using ${resp.toolCalls[0]!.name} result directly`)
      break
    }
  }

  // Safety net for empty responses after a successful action
  if (!finalText.trim() && actionPerformed) {
    finalText = 'Listo.'
  } else if (!finalText.trim()) {
    finalText = 'No te entendí bien, ¿puedes repetir?'
  }

  // Build clean history (only user + final assistant text — drop tool messages)
  const newHistory: AgentOutput['history'] = [
    ...input.history,
    { role: 'user',      content: input.text },
    { role: 'assistant', content: finalText  },
  ].slice(-30)

  return {
    text:                 finalText,
    actionPerformed,
    history:              newHistory,
    modelUsed,
    pendingNotifications,
  }
}
