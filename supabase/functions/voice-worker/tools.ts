/**
 * Tool implementations for the dashboard voice agent.
 *
 * Each tool delegates to direct Supabase queries (no use case layer here —
 * that lives in Vercel-side code which we can't import). The business rules
 * are mirrored faithfully from RealToolExecutor.ts so behavior matches.
 *
 * Tool registry is a Map<name, fn>. The dispatcher in agent.ts picks one,
 * validates args (lightweight — Zod-style not needed here, model is well-trained),
 * and returns a ToolResult.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'
import type { ToolResult, BookingEventData } from './types.ts'

// ── Tool execution context ─────────────────────────────────────────────────

export interface ToolContext {
  // deno-lint-ignore no-explicit-any
  supabase:    SupabaseClient<any>
  businessId:  string
  userId:      string
  timezone:    string
  workingHours?: Record<string, { open: string; close: string } | null>
  /**
   * Concatenated user-side text from this turn + recent history. Used by
   * smartSchedule to verify the LLM didn't hallucinate service_name when
   * the user never actually mentioned a service.
   */
  userTextCorpus?: string
}

// ── Lightweight fuzzy matching (Levenshtein-based) ─────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!)
      prev = tmp
    }
  }
  return dp[b.length]!
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length, 1)
  return 1 - levenshtein(a, b) / max
}

interface FuzzyMatch<T extends { name: string }> {
  status: 'found' | 'ambiguous' | 'not_found'
  match?: T
  candidates?: T[]
}

const FUZZY_THRESHOLD       = 0.72
const FUZZY_AMBIGUOUS_GAP   = 0.10

/** Tokenises a normalised string into word-length>=2 tokens. */
function tokens(s: string): string[] {
  return normalize(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2)
}

/**
 * Token overlap check: at least one query token must match a candidate token
 * either exactly or by a strong prefix (>=3 chars). Kills cross-name false
 * positives like "Luis Romero" matching "Estefany Zulura" through pure
 * Levenshtein noise.
 */
function shareToken(queryTokens: string[], candidateTokens: string[]): boolean {
  for (const q of queryTokens) {
    for (const c of candidateTokens) {
      if (q === c) return true
      if (q.length >= 4 && c.startsWith(q)) return true
      if (c.length >= 4 && q.startsWith(c)) return true
    }
  }
  return false
}

/**
 * Conservative fuzzy match:
 *  - similarity ≥ threshold (Levenshtein-based)
 *  - AND at least one shared token (or strong prefix)
 *
 * The previous `includes(needle)` shortcut was actively harmful: short
 * needles like "lui" matched any candidate containing those three letters
 * in sequence, which is how "Luis Romero" was falling onto "Estefany Zulura"
 * via the contiguous "lu" / "zul" run. Token gating eliminates that class
 * of false positive entirely while still allowing typo recovery.
 */
function fuzzyFind<T extends { name: string }>(items: T[], query: string): FuzzyMatch<T> {
  if (!items.length) return { status: 'not_found' }
  const needle  = normalize(query)
  const qTokens = tokens(query)
  if (qTokens.length === 0) return { status: 'not_found' }

  const scored = items
    .map(item => ({
      item,
      score:  similarity(normalize(item.name), needle),
      tokens: tokens(item.name),
    }))
    .filter(s => s.score >= FUZZY_THRESHOLD && shareToken(qTokens, s.tokens))
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { status: 'not_found' }
  if (scored.length === 1) return { status: 'found', match: scored[0]!.item }

  const [first, second] = scored
  if (first!.score - second!.score >= FUZZY_AMBIGUOUS_GAP) {
    return { status: 'found', match: first!.item }
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 5).map(s => s.item) }
}

// ── Time helpers (timezone-aware) ──────────────────────────────────────────

/**
 * Converts a local datetime (in business timezone) to a UTC ISO string.
 * Mirrors lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts → localToUTC.
 */
function localToUTC(date: string, time: string, tz: string): string {
  const naiveAsUTC = new Date(`${date}T${time}:00Z`)
  const tzStr      = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(naiveAsUTC)
  const tzDisplayedAsUTC = new Date(tzStr.replace(' ', 'T') + 'Z')
  const offsetMs         = naiveAsUTC.getTime() - tzDisplayedAsUTC.getTime()
  return new Date(naiveAsUTC.getTime() + offsetMs).toISOString()
}

function buildEndISO(startISO: string, durationMin: number): string {
  return new Date(new Date(startISO).getTime() + durationMin * 60_000).toISOString()
}

/**
 * Renders a YYYY-MM-DD as "9 de mayo" in the given timezone.
 *
 * CRITICAL — anchored to NOON UTC, not midnight local.
 *
 * The previous version used `new Date(y, m-1, d)` which constructs a Date
 * at midnight in the SERVER'S local timezone. Edge Functions run in UTC,
 * so `new Date(2026, 4, 9)` becomes "2026-05-09 00:00 UTC". When that
 * instant is formatted in a negative-UTC timezone like America/Caracas
 * (UTC-4), it renders as "2026-05-08 20:00 Caracas" → "8 de mayo".
 * Off-by-one bug. The user reported it across THREE different queries:
 *   - "mañana" → response said "8 de mayo" (was May 9)
 *   - "pasado mañana" → response said "9 de mayo" (was May 10)
 *   - "el 16 de mayo" → response said "15 de mayo" (was May 16)
 *
 * Anchoring to NOON UTC (12:00:00Z) keeps the calendar day stable across
 * all timezones from UTC-11 (Niue) to UTC+12 (NZ). 12:00 UTC translates
 * to 01:00–23:00 in any of those zones — always the same calendar day.
 */
function humanizeDate(isoDate: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day: 'numeric', month: 'long', timeZone: timezone,
    }).format(new Date(`${isoDate}T12:00:00Z`))
  } catch {
    return isoDate
  }
}

/**
 * Returns a TTS-friendly Spanish time string in the business timezone.
 *   09:00 → "9 de la mañana"
 *   12:30 → "12 y 30 del mediodía"   (well, 12:00 → "del mediodía"; 12:30 → "de la tarde")
 *   15:00 → "3 de la tarde"
 *   20:30 → "8 y 30 de la noche"
 *
 * Reads naturally aloud and avoids the "a. m. / p. m." pronunciation issues
 * (Deepgram tends to spell "AM" as letters and the periods in "a. m." used
 * to confuse the LLM in the previous architecture — both problems gone).
 */
function formatTimeFromISO(iso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    }).formatToParts(new Date(iso))
    const hour24 = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const minute =          parts.find(p => p.type === 'minute')?.value ?? '00'

    let displayHour: number
    let suffix: string
    if (hour24 === 0)        { displayHour = 12;          suffix = 'de la madrugada' }
    else if (hour24 < 6)     { displayHour = hour24;      suffix = 'de la madrugada' }
    else if (hour24 < 12)    { displayHour = hour24;      suffix = 'de la mañana' }
    else if (hour24 === 12 && minute === '00') { displayHour = 12; suffix = 'del mediodía' }
    else if (hour24 < 19)    { displayHour = hour24 === 12 ? 12 : hour24 - 12; suffix = 'de la tarde' }
    else                     { displayHour = hour24 - 12; suffix = 'de la noche' }

    return minute === '00'
      ? `${displayHour} ${suffix}`
      : `${displayHour} y ${parseInt(minute, 10)} ${suffix}`
  } catch {
    return iso.slice(11, 16)
  }
}

// ── Repository-style helpers ───────────────────────────────────────────────

interface ClientRow { id: string; name: string; phone: string | null }
interface ServiceRow { id: string; name: string; duration_min: number; price: number }

async function getActiveClients(ctx: ToolContext): Promise<ClientRow[]> {
  const { data, error } = await ctx.supabase
    .from('clients')
    .select('id, name, phone')
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null)
  if (error || !data) return []
  return data as ClientRow[]
}

async function getActiveServices(ctx: ToolContext): Promise<ServiceRow[]> {
  const { data, error } = await ctx.supabase
    .from('services')
    .select('id, name, duration_min, price')
    .eq('business_id', ctx.businessId)
    .eq('is_active', true)
  if (error || !data) return []
  return data as ServiceRow[]
}

async function findConflicts(
  ctx:       ToolContext,
  startISO:  string,
  endISO:    string,
  excludeId?: string,
): Promise<boolean> {
  let q = ctx.supabase
    .from('appointments')
    .select('id')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', endISO)
    .gt('end_at', startISO)
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) return false  // fail-open: assume no conflict, let DB handle
  return (data?.length ?? 0) > 0
}

interface ResolveOk    { status: 'found';     client: ClientRow }
interface ResolveAmb   { status: 'ambiguous'; candidates: ClientRow[] }
interface ResolveMiss  { status: 'not_found' }
type ResolveResult = ResolveOk | ResolveAmb | ResolveMiss

async function resolveClient(ctx: ToolContext, name: string): Promise<ResolveResult> {
  const all = await getActiveClients(ctx)
  if (!all.length) return { status: 'not_found' }
  const found = fuzzyFind(all, name)
  if (found.status === 'found')     return { status: 'found',     client: found.match! }
  if (found.status === 'ambiguous') return { status: 'ambiguous', candidates: found.candidates! }
  return { status: 'not_found' }
}

async function resolveService(ctx: ToolContext, nameOrId: string): Promise<ServiceRow | null> {
  const all = await getActiveServices(ctx)
  if (!all.length) return null
  // 1. Exact UUID match
  const exact = all.find(s => s.id === nameOrId)
  if (exact) return exact
  // 2. Fuzzy by name
  const fuzzy = fuzzyFind(all, nameOrId)
  return fuzzy.status === 'found' ? fuzzy.match! : null
}

// ── Tool: smart_schedule ───────────────────────────────────────────────────

interface SmartScheduleArgs {
  service_name: string
  client_name:  string
  date:         string
  time:         string
}

/**
 * Strings the LLM sometimes ships in lieu of asking the user. Treat them as
 * missing — booking without these is the bug the user reported when the
 * assistant scheduled "Gardi para el 21" with no service or time.
 */
const SCHEDULE_PLACEHOLDER = /^(?:\?+|tbd|pendiente|por\s+definir|n\/a|none|null|undefined|sin\s+(?:especificar|definir)|no\s+especificad[oa])$/i

function isScheduleParamMissing(value: string | undefined): boolean {
  if (!value) return true
  const t = value.trim()
  if (t.length === 0) return true
  return SCHEDULE_PLACEHOLDER.test(t)
}

/**
 * Returns the human-readable label of the first missing schedule parameter,
 * or null if all four are present. Order matters — we ask for them in the
 * sequence the user expects (cliente → servicio → fecha → hora).
 */
function firstMissingScheduleParam(args: {
  client_name?: string; service_name?: string; date?: string; time?: string
}): string | null {
  if (isScheduleParamMissing(args.client_name))  return 'el nombre del cliente'
  if (isScheduleParamMissing(args.service_name)) return 'el servicio'
  if (isScheduleParamMissing(args.date))         return 'la fecha'
  if (isScheduleParamMissing(args.time))         return 'la hora'
  return null
}

async function smartSchedule(ctx: ToolContext, args: SmartScheduleArgs): Promise<ToolResult> {
  const { service_name, client_name, date, time } = args

  // Reject empty strings AND placeholders the LLM might invent when it wants
  // to bypass the missing-data prompt. Ask for ONE missing field at a time
  // so the conversation feels natural instead of dumping a checklist.
  const missingLabel = firstMissingScheduleParam({ client_name, service_name, date, time })
  if (missingLabel) {
    return { success: false, result: `Para agendar necesito ${missingLabel}. ¿Me lo dices?` }
  }

  // Anti-hallucination guards: the LLM is allowed to NORMALISE what the user
  // said ("corte" → "Corte de cabello") but it cannot invent a name the user
  // never mentioned. Both service_name AND client_name must trace back to at
  // least one token the user actually said in this turn or a recent user turn.
  //
  // The client guard catches the failure mode where the LLM substitutes a
  // client it has seen recently in context (e.g. one shown in CITAS DE HOY
  // or in a previous turn) for the one the user actually requested.
  if (ctx.userTextCorpus) {
    const corpus = normalize(ctx.userTextCorpus)
    const inCorpus = (name: string): boolean => {
      const ts = tokens(name)
      if (ts.length === 0) return false
      // At least ONE non-trivial token of the name must appear in the corpus
      // (length >= 3 to skip articles / connectors).
      return ts.some(t => t.length >= 3 && corpus.includes(t))
    }
    if (!inCorpus(service_name)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated service="${service_name}" (no token in user corpus)`)
      return { success: false, result: 'Para agendar necesito el servicio. ¿Para qué servicio?' }
    }
    if (!inCorpus(client_name)) {
      console.log(`[VOICE-WORKER-TOOLS] smart_schedule REJECTED — hallucinated client="${client_name}" (no token in user corpus)`)
      return { success: false, result: 'Para agendar necesito el nombre del cliente. ¿A quién agendo?' }
    }
  }

  // 1. Resolve client (auto-create if not found)
  let client: ClientRow
  const resolution = await resolveClient(ctx, client_name)
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: false, result: `Hay varios clientes con nombre similar: ${names}. ¿Cuál es?` }
  }
  if (resolution.status === 'found') {
    client = resolution.client
  } else {
    const { data: created, error } = await ctx.supabase
      .from('clients')
      .insert({ business_id: ctx.businessId, name: client_name })
      .select('id, name, phone')
      .single()
    if (error || !created) {
      return { success: false, result: `No pude registrar a ${client_name}: ${error?.message ?? 'error desconocido'}` }
    }
    client = created as ClientRow
  }

  // 2. Resolve service
  const service = await resolveService(ctx, service_name)
  if (!service) {
    const all = await getActiveServices(ctx)
    const catalog = all.map(s => s.name).join(', ') || 'ninguno'
    return { success: false, result: `No encontré el servicio "${service_name}". Disponibles: ${catalog}.` }
  }

  // 3. Compute slot in UTC + check conflicts
  const startISO = localToUTC(date, time, ctx.timezone)
  const endISO   = buildEndISO(startISO, service.duration_min)
  if (await findConflicts(ctx, startISO, endISO)) {
    return { success: false, result: `El horario ${time} del ${date} ya está ocupado. Elige otra hora.` }
  }

  // 4. Insert appointment (trigger handles appointment_services junction)
  const { data: created, error } = await ctx.supabase
    .from('appointments')
    .insert({
      business_id: ctx.businessId,
      client_id:   client.id,
      service_id:  service.id,
      start_at:    startISO,
      end_at:      endISO,
      status:      'pending',
    })
    .select('id')
    .single()

  if (error || !created) {
    return { success: false, result: `No pude crear la cita: ${error?.message ?? 'error desconocido'}` }
  }

  const data: BookingEventData = {
    appointmentId: created.id as string,
    clientName:    client.name,
    serviceName:   service.name,
    date,
    time,
    action:        'created',
  }
  return {
    success: true,
    result:  `Listo. Agendé a ${client.name} para ${service.name} el ${date} a las ${time}.`,
    data,
  }
}

// ── Tool: cancel_booking ───────────────────────────────────────────────────

interface CancelBookingArgs {
  client_name: string
  date?:       string
  time?:       string
}

interface AppointmentForLookup {
  id:         string
  start_at:   string
  end_at:     string
  client_id:  string | null
  service_id: string | null
  /** Service IDs from the junction table — used as fallback when service_id is null. */
  appointment_services?: Array<{ service_id: string; sort_order: number }>
}

async function findAppointmentByClientName(
  ctx:    ToolContext,
  client: ClientRow,
  date?:  string,
  time?:  string,
): Promise<AppointmentForLookup | { error: string }> {
  const targetDate = date ?? new Date().toLocaleDateString('en-CA', { timeZone: ctx.timezone })
  const startISO   = localToUTC(targetDate, '00:00', ctx.timezone)
  const endISO     = localToUTC(targetDate, '23:59', ctx.timezone)

  // Include the appointment_services junction so callers can find the service
  // even when service_id is null on the appointment row.
  const q = ctx.supabase
    .from('appointments')
    .select('id, start_at, end_at, client_id, service_id, appointment_services(service_id, sort_order)')
    .eq('business_id', ctx.businessId)
    .eq('client_id', client.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .order('start_at')

  const { data, error } = await q
  if (error) return { error: `Error buscando cita: ${error.message}` }
  const list = (data ?? []) as unknown as AppointmentForLookup[]
  if (list.length === 0) return { error: `No encontré cita activa de ${client.name} el ${targetDate}.` }
  if (list.length === 1) return list[0]!

  if (time) {
    const matched = list.find(a => formatTimeFromISO(a.start_at, ctx.timezone).startsWith(time.split(':')[0]!))
    if (matched) return matched
  }
  const labels = list.slice(0, 3).map(a => formatTimeFromISO(a.start_at, ctx.timezone)).join(', ')
  return { error: `${client.name} tiene varias citas el ${targetDate}: ${labels}. ¿Cuál cancelo?` }
}

/**
 * Resolves the canonical service_id for an appointment, checking the direct FK
 * first and falling back to the lowest-sort-order entry in the junction table.
 */
function resolveAppointmentServiceId(apt: AppointmentForLookup): string | null {
  if (apt.service_id) return apt.service_id
  const sorted = (apt.appointment_services ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
  return sorted[0]?.service_id ?? null
}

async function cancelBooking(ctx: ToolContext, args: CancelBookingArgs): Promise<ToolResult> {
  if (!args.client_name) return { success: false, result: 'Necesito el nombre del cliente para cancelar.' }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status !== 'found') {
    if (resolution.status === 'ambiguous') {
      const names = resolution.candidates.map(c => c.name).join(', ')
      return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
    }
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  const apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
  if ('error' in apt) return { success: false, result: apt.error }

  // Service name with junction-table fallback
  let serviceName = 'Servicio'
  const serviceId = resolveAppointmentServiceId(apt)
  if (serviceId) {
    const svc = await resolveService(ctx, serviceId)
    if (svc) serviceName = svc.name
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude cancelar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName:    resolution.client.name,
    serviceName,
    date: apt.start_at.slice(0, 10),
    time: apt.start_at.slice(11, 16),
    action: 'cancelled',
  }
  return {
    success: true,
    result:  `Listo. Cancelé la cita de ${resolution.client.name} (${serviceName}).`,
    data,
  }
}

// ── Tool: reschedule_booking ───────────────────────────────────────────────

interface RescheduleBookingArgs {
  client_name: string
  date?:       string
  time?:       string
  new_date:    string
  new_time:    string
}

async function rescheduleBooking(ctx: ToolContext, args: RescheduleBookingArgs): Promise<ToolResult> {
  if (!args.client_name || !args.new_date || !args.new_time) {
    return { success: false, result: 'Necesito el cliente y la nueva fecha/hora.' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status !== 'found') {
    if (resolution.status === 'ambiguous') {
      const names = resolution.candidates.map(c => c.name).join(', ')
      return { success: false, result: `Hay varios clientes similares: ${names}. ¿Cuál?` }
    }
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  const apt = await findAppointmentByClientName(ctx, resolution.client, args.date, args.time)
  if ('error' in apt) return { success: false, result: apt.error }

  // Service for duration + name (junction-table fallback)
  let durationMin = 60
  let serviceName = 'Servicio'
  const serviceId = resolveAppointmentServiceId(apt)
  if (serviceId) {
    const svc = await resolveService(ctx, serviceId)
    if (svc) {
      durationMin = svc.duration_min
      serviceName = svc.name
    }
  }

  const newStartISO = localToUTC(args.new_date, args.new_time, ctx.timezone)
  const newEndISO   = buildEndISO(newStartISO, durationMin)

  if (await findConflicts(ctx, newStartISO, newEndISO, apt.id)) {
    return { success: false, result: `El horario ${args.new_time} del ${args.new_date} ya está ocupado. Elige otra hora.` }
  }

  const { error } = await ctx.supabase
    .from('appointments')
    .update({ start_at: newStartISO, end_at: newEndISO })
    .eq('id', apt.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude reagendar: ${error.message}` }

  const data: BookingEventData = {
    appointmentId: apt.id,
    clientName:    resolution.client.name,
    serviceName,
    date: args.new_date,
    time: args.new_time,
    action: 'rescheduled',
  }
  return {
    success: true,
    result:  `Listo. Reagendé la cita de ${resolution.client.name} para el ${args.new_date} a las ${args.new_time}.`,
    data,
  }
}

// ── Tool: get_appointments_by_date ─────────────────────────────────────────

interface GetByDateArgs { date: string }

async function getAppointmentsByDate(ctx: ToolContext, args: GetByDateArgs): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }

  // Day boundaries in business timezone → UTC.
  const startISO = localToUTC(args.date, '00:00', ctx.timezone)
  const endISO   = localToUTC(args.date, '23:59', ctx.timezone)

  // CRITICAL: select BOTH `service:services` (direct FK on appointments.service_id)
  // AND `appointment_services` (junction table for multi-service or trigger-only
  // appointments). Mirrors the proven pattern in lib/repositories/SupabaseAppointmentRepository.ts.
  // The previous query only had the direct FK; appointments stored solely via the
  // junction table came back with service=null, causing empty service names in
  // the formatted result and confusing the LLM.
  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      id,
      start_at,
      status,
      client:clients(name),
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .neq('status', 'cancelled')
    .gte('start_at', startISO)
    .lte('start_at', endISO)
    .order('start_at')

  console.log(`[VOICE-WORKER-TOOLS] get_appointments_by_date date=${args.date} tz=${ctx.timezone} range=[${startISO} → ${endISO}] found=${data?.length ?? 0}`)

  if (error) return { success: false, result: `Error al consultar citas: ${error.message}` }

  const dateLabel = humanizeDate(args.date, ctx.timezone)
  if (!data?.length) return { success: true, result: `No hay citas para el ${dateLabel}.` }

  type AptRow = {
    start_at: string
    client?:  { name?: string } | null
    service?: { name?: string } | null
    appointment_services?: Array<{
      sort_order: number
      service?:   { name?: string } | null
    }>
  }

  const items = (data as unknown as AptRow[]).map((row) => {
    const time = formatTimeFromISO(row.start_at, ctx.timezone)
    const cli  = row.client?.name ?? 'cliente'
    // Direct FK first; fall back to the first service in the junction.
    const junctionServices = (row.appointment_services ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
    const svc = row.service?.name
      ?? junctionServices[0]?.service?.name
      ?? 'servicio'
    return `${cli} a las ${time} para ${svc}`
  })

  console.log(`[VOICE-WORKER-TOOLS] First formatted line: "${items[0] ?? ''}"`)

  // User-facing string. The agent loop bypasses LLM synthesis when a single
  // tool call succeeds and uses this text directly as the spoken response.
  // It must read naturally end-to-end:
  //   - opener ends with a period (TTS pauses naturally)
  //   - items joined by ". " so each gets a pause and clear cadence
  //   - final period prevents the abrupt cut-off the user reported
  const opener = data.length === 1
    ? `Tienes 1 cita el ${dateLabel}.`
    : `Tienes ${data.length} citas el ${dateLabel}.`

  return {
    success: true,
    result:  `${opener} ${items.join('. ')}.`,
  }
}

// ── Tool: search_clients ───────────────────────────────────────────────────

interface SearchClientsArgs { query: string }

async function searchClients(ctx: ToolContext, args: SearchClientsArgs): Promise<ToolResult> {
  if (!args.query || args.query.length < 2) {
    return { success: false, result: 'Necesito al menos 2 caracteres para buscar.' }
  }

  const all = await getActiveClients(ctx)
  if (!all.length) {
    // User-facing prose. Tool result is read directly via bypass — must
    // sound natural when spoken aloud.
    return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
  }

  const found = fuzzyFind(all, args.query)

  if (found.status === 'found') {
    const m = found.match!
    const phoneStr = m.phone ? `, su teléfono es ${m.phone}` : ', no tiene teléfono registrado'
    return { success: true, result: `Sí, ${m.name} está entre tus clientes${phoneStr}.` }
  }

  if (found.status === 'ambiguous') {
    const candidates = found.candidates!
    const opener = `Tengo ${candidates.length} clientes con nombre similar a ${args.query}.`
    const items  = candidates
      .map(c => c.phone ? `${c.name}, teléfono ${c.phone}` : `${c.name}, sin teléfono registrado`)
      .join('. ')
    return { success: true, result: `${opener} ${items}. ¿A cuál te refieres?` }
  }

  return { success: true, result: `No tengo a ${args.query} entre tus clientes. Si lo agendas, queda registrado automáticamente.` }
}

// ── Tool: get_last_visit ───────────────────────────────────────────────────

interface GetLastVisitArgs { client_name: string }

interface LastVisitRow {
  id:        string
  start_at:  string
  status:    string
  service?:  { name?: string } | null
  appointment_services?: Array<{ sort_order: number; service?: { name?: string } | null }>
}

async function getLastVisit(ctx: ToolContext, args: GetLastVisitArgs): Promise<ToolResult> {
  if (!args.client_name) {
    return { success: false, result: 'Necesito el nombre del cliente.' }
  }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: true, result: `No tengo a ${args.client_name} entre tus clientes.` }
  }
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map(c => c.name).join(', ')
    return { success: true, result: `Hay varios clientes con nombre similar: ${names}. ¿A cuál te refieres?` }
  }
  const client = resolution.client

  const nowISO = new Date().toISOString()
  const { data, error } = await ctx.supabase
    .from('appointments')
    .select(`
      id,
      start_at,
      status,
      service:services(name),
      appointment_services(sort_order, service:services(name))
    `)
    .eq('business_id', ctx.businessId)
    .eq('client_id', client.id)
    .lt('start_at', nowISO)
    .order('start_at', { ascending: false })
    .limit(1)

  if (error) return { success: false, result: `Error al consultar la última visita: ${error.message}` }
  if (!data?.length) {
    return { success: true, result: `${client.name} no tiene visitas anteriores registradas.` }
  }

  const apt = data[0] as unknown as LastVisitRow
  const isoDate = apt.start_at.slice(0, 10)
  const dateLabel = humanizeDate(isoDate, ctx.timezone)

  // Direct FK first; fall back to junction table.
  const junctionServices = (apt.appointment_services ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
  const serviceName = apt.service?.name
    ?? junctionServices[0]?.service?.name
    ?? ''

  const STATUS_PHRASE: Record<string, string> = {
    completed: 'asistió y completó el servicio',
    no_show:   'no asistió a la cita',
    cancelled: 'la cita fue cancelada',
    confirmed: 'la cita estaba confirmada',
    pending:   'la cita estaba pendiente',
  }
  const statusPhrase = STATUS_PHRASE[apt.status] ?? 'tuvo una cita'
  const svcPart = serviceName ? ` para ${serviceName}` : ''

  return {
    success: true,
    result: `La última cita de ${client.name} fue el ${dateLabel}${svcPart}. ${capitalize(statusPhrase)}.`,
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

// ── Tool: get_services ─────────────────────────────────────────────────────

async function getServices(ctx: ToolContext): Promise<ToolResult> {
  const all = await getActiveServices(ctx)
  if (!all.length) return { success: true, result: 'No hay servicios configurados.' }
  const lines = all.map(s => `${s.name} (${s.duration_min} min, $${s.price})`)
  return { success: true, result: `Servicios disponibles: ${lines.join(', ')}.` }
}

// ── Tool: create_client ────────────────────────────────────────────────────

interface CreateClientArgs { name: string; phone?: string }

async function createClient(ctx: ToolContext, args: CreateClientArgs): Promise<ToolResult> {
  if (!args.name) return { success: false, result: 'Necesito el nombre del cliente.' }

  const { data, error } = await ctx.supabase
    .from('clients')
    .insert({
      business_id: ctx.businessId,
      name:        args.name,
      phone:       args.phone ?? null,
    })
    .select('id, name')
    .single()

  if (error || !data) return { success: false, result: `No se pudo registrar: ${error?.message ?? 'desconocido'}` }
  return { success: true, result: `Cliente "${(data as { name: string }).name}" registrado.` }
}

// ── Tool: delete_client ────────────────────────────────────────────────────

interface DeleteClientArgs {
  client_name: string
  /**
   * Optional. When two or more clients share the name, the LLM passes the
   * phone the user spoke ("elimina a Luis Romero con teléfono X") so we can
   * pick the right row. If multiple rows still match the same phone (true
   * duplicates), we delete the oldest one deterministically.
   */
  phone?: string
  /**
   * Set when the user has given explicit consent to remove a duplicate
   * ("elimina a cualquiera", "borra los duplicados", "elimina uno"). When
   * true AND every ambiguous candidate shares the same phone, we skip the
   * "are they duplicates?" prompt and just delete the first one — without
   * this flag the assistant would loop on the confirmation question.
   */
  any_duplicate?: boolean
}

/** Strip everything but digits — matches WhatsApp's normalisation. */
function normalisePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D+/g, '')
}

async function deleteClient(ctx: ToolContext, args: DeleteClientArgs): Promise<ToolResult> {
  if (!args.client_name) return { success: false, result: 'Necesito el nombre del cliente.' }

  const resolution = await resolveClient(ctx, args.client_name)
  if (resolution.status === 'not_found') {
    return { success: false, result: `No encontré al cliente "${args.client_name}".` }
  }

  // Single match → delete straight away.
  let target: ClientRow
  if (resolution.status === 'found') {
    target = resolution.client
  } else {
    // Ambiguous — multiple clients share this name.
    const candidates = resolution.candidates
    const wantedPhone = normalisePhone(args.phone)

    if (!wantedPhone) {
      // No phone hint from the user → list candidates WITH their phones so the
      // next turn can disambiguate. If every candidate shares the same phone
      // we surface that fact ("son duplicados") so the user can confirm in
      // one go.
      const phones = candidates.map(c => normalisePhone(c.phone))
      const allSame = phones.every(p => p === phones[0])
      if (allSame) {
        // If the user already said "cualquiera" / "los duplicados", skip the
        // confirmation question and delete the first one straight away.
        if (args.any_duplicate) {
          target = candidates[0]!
        } else {
          const phoneStr = phones[0] ? `con el mismo teléfono ${candidates[0]!.phone}` : 'sin teléfono registrado'
          return {
            success: false,
            result: `Tengo ${candidates.length} clientes llamados ${candidates[0]!.name} ${phoneStr} — parecen duplicados. ¿Elimino uno y dejo el otro?`,
          }
        }
      } else {
        const list = candidates
          .map(c => c.phone ? `${c.name} con teléfono ${c.phone}` : `${c.name} sin teléfono`)
          .join(', ')
        return { success: false, result: `Hay varios clientes llamados ${candidates[0]!.name}: ${list}. ¿Cuál elimino, dime el teléfono?` }
      }
    } else {
      // Phone hint provided → filter candidates.
      const matches = candidates.filter(c => normalisePhone(c.phone) === wantedPhone)
      if (matches.length === 0) {
        return { success: false, result: `No encontré a ${args.client_name} con el teléfono ${args.phone}.` }
      }
      // 1+ matches → take the first deterministically. When multiple rows
      // share name+phone they are real duplicates and any of them is fine.
      target = matches[0]!
    }
  }

  // Block delete if client has future appointments (mirrors DeleteClientUseCase)
  const { count } = await ctx.supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .eq('client_id', target.id)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())

  if ((count ?? 0) > 0) {
    return { success: false, result: `No se puede eliminar: ${target.name} tiene ${count} cita(s) futura(s). Cancélalas primero.` }
  }

  const { error } = await ctx.supabase
    .from('clients')
    .delete()
    .eq('id', target.id)
    .eq('business_id', ctx.businessId)

  if (error) return { success: false, result: `No pude eliminar: ${error.message}` }
  const phoneSuffix = target.phone ? ` (teléfono ${target.phone})` : ''
  return { success: true, result: `Cliente ${target.name}${phoneSuffix} eliminado.` }
}

// ── Tool: get_available_slots ──────────────────────────────────────────────

interface GetAvailableSlotsArgs { date: string; duration_min: number }

async function getAvailableSlots(ctx: ToolContext, args: GetAvailableSlotsArgs): Promise<ToolResult> {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    return { success: false, result: 'Necesito una fecha válida (YYYY-MM-DD).' }
  }
  if (!args.duration_min || args.duration_min < 5 || args.duration_min > 480) {
    return { success: false, result: 'Necesito una duración entre 5 y 480 minutos.' }
  }

  // Day of week for the requested date in business timezone
  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', timeZone: ctx.timezone,
  }).format(new Date(`${args.date}T12:00:00Z`)).toLowerCase()

  const wh = ctx.workingHours?.[dayOfWeek]
  if (ctx.workingHours && Object.prototype.hasOwnProperty.call(ctx.workingHours, dayOfWeek) && !wh) {
    return { success: true, result: `El negocio está cerrado el ${args.date}.` }
  }

  // Default working hours when unset: 09:00-18:00
  const open  = wh?.open  ?? '09:00'
  const close = wh?.close ?? '18:00'

  // Get all booked intervals for the day
  const { data: booked, error } = await ctx.supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', ctx.businessId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', `${args.date}T00:00:00`)
    .lte('start_at', `${args.date}T23:59:59`)
    .order('start_at')

  if (error) return { success: false, result: `Error al consultar disponibilidad: ${error.message}` }

  // Generate candidate slots every 30 minutes within working hours
  const SLOT_INTERVAL = 30
  const free: string[] = []
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)

  for (let h = oh!; h < ch!; h++) {
    for (let m = (h === oh ? om! : 0); m < 60; m += SLOT_INTERVAL) {
      if (h === ch && m >= cm!) break
      const candidateTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const startISO = localToUTC(args.date, candidateTime, ctx.timezone)
      const endISO   = buildEndISO(startISO, args.duration_min)
      const conflict = (booked ?? []).some((b: { start_at: string; end_at: string }) =>
        new Date(b.start_at) < new Date(endISO) && new Date(b.end_at) > new Date(startISO)
      )
      if (!conflict) free.push(candidateTime)
    }
  }

  if (!free.length) return { success: true, result: `No hay horarios libres para el ${args.date}.` }
  return { success: true, result: `Horarios libres el ${args.date}: ${free.join(', ')}.` }
}

// ── Dispatcher + tool definitions for the LLM ──────────────────────────────

export interface ToolDefinition {
  type: 'function'
  function: {
    name:        string
    description: string
    parameters:  Record<string, unknown>
  }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'smart_schedule',
      description: 'Agenda una cita en un solo paso. Llama SOLO cuando tengas servicio + cliente + fecha + hora.',
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Nombre del servicio' },
          client_name:  { type: 'string', description: 'Nombre del cliente' },
          date:         { type: 'string', description: 'YYYY-MM-DD' },
          time:         { type: 'string', description: 'HH:mm 24h' },
        },
        required: ['service_name', 'client_name', 'date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Cancela una cita. Pasa client_name; date/time opcionales para desambiguar.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD opcional' },
          time:        { type: 'string', description: 'HH:mm opcional' },
        },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_booking',
      description: 'Reagenda una cita a una nueva fecha/hora.',
      parameters: {
        type: 'object',
        properties: {
          client_name: { type: 'string' },
          date:        { type: 'string', description: 'YYYY-MM-DD actual (opcional)' },
          time:        { type: 'string', description: 'HH:mm actual (opcional)' },
          new_date:    { type: 'string', description: 'YYYY-MM-DD nuevo' },
          new_time:    { type: 'string', description: 'HH:mm nuevo' },
        },
        required: ['client_name', 'new_date', 'new_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_appointments_by_date',
      description: 'Lista citas de un día específico.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Busca un cliente por nombre. Devuelve nombre y teléfono.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Mínimo 2 caracteres' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_last_visit',
      description: 'Devuelve la última cita pasada de un cliente: fecha, servicio y si asistió, no asistió o fue cancelada.',
      parameters: {
        type: 'object',
        properties: { client_name: { type: 'string', description: 'Nombre del cliente' } },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_services',
      description: 'Lista los servicios del negocio.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_client',
      description: 'Registra un cliente nuevo (cuando el usuario pida explícitamente registrar).',
      parameters: {
        type: 'object',
        properties: {
          name:  { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_client',
      description: 'Elimina un cliente. Pasa phone cuando dos clientes compartan el nombre. Pasa any_duplicate=true cuando el usuario diga "elimina a cualquiera" / "borra los duplicados" / "elimina uno". Falla si tiene citas futuras.',
      parameters: {
        type: 'object',
        properties: {
          client_name:   { type: 'string' },
          phone:         { type: 'string',  description: 'Teléfono para desambiguar entre clientes con el mismo nombre' },
          any_duplicate: { type: 'boolean', description: 'true cuando el usuario consintió borrar uno de los duplicados sin importar cuál' },
        },
        required: ['client_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Consulta horarios libres para una fecha y duración.',
      parameters: {
        type: 'object',
        properties: {
          date:         { type: 'string', description: 'YYYY-MM-DD' },
          duration_min: { type: 'number', description: '5-480' },
        },
        required: ['date', 'duration_min'],
      },
    },
  },
]

export const WRITE_TOOLS = new Set([
  'smart_schedule', 'cancel_booking', 'reschedule_booking',
  'create_client', 'delete_client',
])

/** Single dispatcher — agent.ts only needs to know this. */
export async function executeTool(
  toolName: string,
  args:     Record<string, unknown>,
  ctx:      ToolContext,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'smart_schedule':           return await smartSchedule(ctx, args as unknown as SmartScheduleArgs)
      case 'cancel_booking':           return await cancelBooking(ctx, args as unknown as CancelBookingArgs)
      case 'reschedule_booking':       return await rescheduleBooking(ctx, args as unknown as RescheduleBookingArgs)
      case 'get_appointments_by_date': return await getAppointmentsByDate(ctx, args as unknown as GetByDateArgs)
      case 'search_clients':           return await searchClients(ctx, args as unknown as SearchClientsArgs)
      case 'get_last_visit':           return await getLastVisit(ctx, args as unknown as GetLastVisitArgs)
      case 'get_services':             return await getServices(ctx)
      case 'create_client':            return await createClient(ctx, args as unknown as CreateClientArgs)
      case 'delete_client':            return await deleteClient(ctx, args as unknown as DeleteClientArgs)
      case 'get_available_slots':      return await getAvailableSlots(ctx, args as unknown as GetAvailableSlotsArgs)
      default:
        return { success: false, result: `Tool desconocida: ${toolName}`, error: 'TOOL_NOT_FOUND' }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[VOICE-WORKER-TOOLS] ${toolName} threw: ${msg}`)
    return { success: false, result: 'Error interno al ejecutar la acción.', error: msg }
  }
}
