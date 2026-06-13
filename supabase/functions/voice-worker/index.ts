/**
 * voice-worker Edge Function — entry point.
 *
 * Pipeline:
 *   1. Parse multipart form (audio + timezone) OR JSON ({text, timezone})
 *   2. Validate JWT (auto-handled by verify_jwt=true in supabase/config.toml)
 *   3. Resolve user → business
 *   4. Rate limit check (per user, 30/min)
 *   5. STT via Deepgram Nova-2 (skip if input is text)
 *   6. Load business context (services, today's appointments, working hours, ai rules)
 *   7. Load session history from Redis
 *   8. Run agent loop
 *   9. Save session
 *   10. Fire bell notifications (fire-and-forget)
 *   11. TTS via Deepgram
 *   12. Return { text, audioUrl, actionPerformed, transcription, modelUsed }
 *
 * No QStash, no polling, no job_store. One synchronous request → one response.
 */

import { serve }       from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from '@supabase/supabase-js'

import { transcribe }            from './stt.ts'
import { getClientFirstNamesForBoost } from './core/repos/clients.ts'
import { runAgent }              from './agent.ts'
import { dispatchBellNotification } from './notifications.ts'
import { checkRateLimit, redisGet, redisSet } from './redis.ts'
import { loadSession, saveSession } from './core/session.ts'
import { buildUserCorpus }       from './core/conversation/frame.ts'
import { localToUTC }            from './core/time-format.ts'
import { createTracer, shortHash } from '../_shared/observability/index.ts'
import type { TraceOutcome }     from '../_shared/observability/contracts.ts'
import type { ToolContext }      from './core/tool-context.ts'
import type {
  AgentInput, BusinessContext, UserRole, VoiceWorkerResponse,
} from './types.ts'

// ── CORS ───────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/**
 * Validates client-supplied conversation history. Untrusted input — must
 * shape-check every entry, cap length, truncate over-long content, drop
 * unknown roles. Output is safe to feed straight into the agent.
 */
function sanitiseClientHistory(raw: unknown): AgentInput['history'] {
  if (!Array.isArray(raw)) return []
  const out: AgentInput['history'] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { role?: unknown; content?: unknown }
    if ((e.role !== 'user' && e.role !== 'assistant') || typeof e.content !== 'string') continue
    out.push({ role: e.role, content: e.content.slice(0, 2000) })
    if (out.length >= 30) break
  }
  return out
}

// ── Supabase admin client (service role) ───────────────────────────────────

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── User → business resolver ───────────────────────────────────────────────

interface UserContext {
  userId:     string
  userName:   string
  userRole:   UserRole
  businessId: string
}

// Per-turn tracer. The agent loop opens/closes its own trace, but turns that
// bail BEFORE runAgent (rate-limit, unintelligible STT, payload error) used to
// produce no trace row at all — a "la voz no respondió" turn vanished from
// /dashboard/observability. This records a minimal trace for those exits so the
// dashboard sees them. Only callable once userCtx is known (we need a scope).
const tracer = createTracer()

async function recordEarlyExitTrace(
  userCtx:   UserContext,
  timezone:  string,
  text:      string,
  outcome:   TraceOutcome,
  errorCode: string,
): Promise<void> {
  try {
    const trace = tracer.start(
      { businessId: userCtx.businessId, channel: 'voice-worker', actorKind: 'user', actorKey: userCtx.userId },
      await shortHash(text),
      { timezone },
    )
    await trace.finish({ outcome, errorCode })
  } catch (err) {
    // Observability must never break the actual response path.
    console.error('[VOICE-WORKER] early-exit trace failed', err)
  }
}

// JWT-keyed auth cache. Skips both `auth.getUser` (verifies JWT signature
// + checks revocation, ~50–100 ms) and the `users` profile select
// (~30–80 ms) when the same JWT was resolved within the last 60 s. The
// 60-second TTL is the revocation grace window: a token that gets
// invalidated mid-window will keep working until the cache entry
// expires. Acceptable for a voice-assistant flow where the worst case
// is one extra agent turn after logout.
const AUTH_CACHE_TTL = 60

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s)
  const hash  = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// deno-lint-ignore no-explicit-any
async function resolveUserAndBusiness(supabase: any, authHeader: string): Promise<UserContext | null> {
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return null

  // Cache lookup keyed by the JWT hash (don't store the JWT itself in Redis).
  const jwtHash = await sha256Hex(jwt)
  const cacheKey = `auth:jwt:${jwtHash.slice(0, 32)}`
  const cached = await redisGet(cacheKey)
  if (cached) {
    try {
      const ctx = JSON.parse(cached) as UserContext
      if (ctx && ctx.userId && ctx.businessId) return ctx
    } catch { /* fall through to fresh lookup */ }
  }

  // Verify JWT and get user
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) return null

  // Read user profile
  const { data: profile } = await supabase
    .from('users')
    .select('id, name, role, business_id')
    .eq('id', userData.user.id)
    .single()

  if (!profile?.business_id) return null

  const ctx: UserContext = {
    userId:     profile.id as string,
    userName:   (profile.name as string | null) ?? 'Usuario',
    userRole:   ((profile.role as string | null) ?? 'employee') as UserRole,
    businessId: profile.business_id as string,
  }
  // Fire-and-forget: caching is an optimisation, never a correctness gate.
  void redisSet(cacheKey, JSON.stringify(ctx), AUTH_CACHE_TTL)
  return ctx
}

// ── Business context loader ────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function loadBusinessContext(supabase: any, businessId: string, timezone: string): Promise<BusinessContext> {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: timezone })

  const [bizRes, servicesRes, apptsRes, clientsRes, staffRes] = await Promise.all([
    supabase.from('businesses').select('name, settings').eq('id', businessId).single(),
    supabase.from('services').select('id, name, duration_min, price').eq('business_id', businessId).eq('is_active', true),
    // Local day converted to UTC — start_at is stored in UTC, so the naive
    // `${todayLocal}T00:00:00` strings queried a UTC day offset from the
    // business's local day and the prompt's "CITAS DE HOY" reference list
    // was wrong in any tz ≠ UTC (same bug class available-slots already fixed).
    supabase.from('appointments')
      .select('start_at, client:clients(name), service:services(name)')
      .eq('business_id', businessId)
      .neq('status', 'cancelled')
      .gte('start_at', localToUTC(todayLocal, '00:00', timezone))
      .lte('start_at', localToUTC(todayLocal, '23:59', timezone))
      .order('start_at'),
    supabase.from('clients')
      .select('id, name, phone')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('last_visit_at', { ascending: false, nullsFirst: false })
      .order('created_at',    { ascending: false })
      .limit(100),
    // Assignable team members — gates the staff-assignment prompt section.
    supabase.from('users')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('role', ['owner', 'admin', 'employee'])
      .order('created_at', { ascending: true }),
  ])

  const settings = (bizRes.data?.settings ?? {}) as Record<string, unknown>
  const aiRules      = typeof settings.aiRules === 'string' ? settings.aiRules : undefined
  const workingHours = settings.workingHours as Record<string, { open: string; close: string } | null> | undefined

  return {
    businessId,
    businessName:  (bizRes.data?.name as string | null) ?? 'tu negocio',
    timezone,
    aiRules,
    workingHours,
    services: (servicesRes.data ?? []).map((s: Record<string, unknown>) => ({
      id:           s.id           as string,
      name:         s.name         as string,
      duration_min: s.duration_min as number,
      price:        s.price        as number,
    })),
    activeAppointments: (apptsRes.data ?? []).map((a: Record<string, unknown>) => ({
      startAt:     a.start_at as string,
      clientName:  ((a.client  as { name?: string } | null)?.name) ?? '',
      serviceName: ((a.service as { name?: string } | null)?.name) ?? '',
    })),
    activeClients: (clientsRes.data ?? []).map((c: Record<string, unknown>) => ({
      id:    c.id    as string,
      name:  c.name  as string,
      phone: (c.phone as string | null) ?? null,
    })),
    activeStaff: (staffRes.data ?? []).map((s: Record<string, unknown>) => ({
      id:   s.id   as string,
      name: s.name as string,
    })),
  }
}

// ── HTTP handler ───────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const t0 = Date.now()
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)

  let supabase
  try { supabase = getAdminClient() } catch (err) {
    console.error('[VOICE-WORKER] Supabase client init failed', err)
    return jsonResponse({ error: 'Servidor no configurado' }, 500)
  }

  // 1. Auth
  const userCtx = await resolveUserAndBusiness(supabase, authHeader)
  if (!userCtx) return jsonResponse({ error: 'Unauthorized' }, 401)

  // 2. Rate limit
  const rl = await checkRateLimit(userCtx.userId, 30)
  if (!rl.allowed) {
    await recordEarlyExitTrace(userCtx, 'UTC', '', 'rate_limited', 'RATE_LIMITED')
    return jsonResponse({ error: `Demasiadas solicitudes. Reintenta en ${rl.retryAfter}s.` }, 429)
  }

  // 3. Parse payload (audio multipart OR text json).
  // For the audio path: STT (Deepgram Nova-2, ~300–700ms) and business context
  // loading (2 Supabase queries, ~100–200ms) run in parallel via Promise.all.
  // The two are independent — context only needs businessId (resolved above).
  // Text path (Web Speech API, desktop): context loads immediately since there
  // is no STT roundtrip to overlap with.
  let inputText     = ''
  let timezone      = 'UTC'
  let transcription = ''
  let clientHistory: AgentInput['history'] = []

  let context: BusinessContext
  let history: AgentInput['history']
  let sessionLastRef: import('./core/session.ts').LastReferencedAppointment | null = null

  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      // ── Text path (Web Speech API / desktop) ──────────────────────────────
      // No STT roundtrip — parse body first, then load context.
      const body = await req.json() as {
        text?:     string
        timezone?: string
        history?:  AgentInput['history']
      }
      inputText     = (body.text ?? '').trim()
      timezone      = body.timezone ?? 'UTC'
      clientHistory = sanitiseClientHistory(body.history)
      transcription = inputText

      // Noise / gibberish guard (text path)
      const MEANINGFUL_TEXT = /[a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9]/
      if (inputText.length < 3 || !MEANINGFUL_TEXT.test(inputText)) {
        await recordEarlyExitTrace(userCtx, timezone, inputText, 'no_action', 'STT_NOISE')
        return jsonResponse({ error: 'No logré captar lo que dijiste. ¿Puedes repetir?' }, 422)
      }

      console.log(`[VOICE-WORKER] Request (text): user=${userCtx.userId.slice(0, 8)} biz=${userCtx.businessId.slice(0, 8)} tz=${timezone} text="${inputText.slice(0, 80)}"`)

      // Load context sequentially — nothing to parallelize in the text path.
      const [ctx, sessionResult] = await Promise.all([
        loadBusinessContext(supabase, userCtx.businessId, timezone),
        loadSession(userCtx.userId, clientHistory),
      ])
      context        = ctx
      history        = sessionResult.session.messages
      sessionLastRef = sessionResult.session.lastRef ?? null
      console.log(`[VOICE-WORKER] history source=${sessionResult.source} length=${history.length} lastRef=${sessionLastRef ? sessionLastRef.clientName : '∅'}`)

    } else {
      // ── Audio path (MediaRecorder / mobile) ───────────────────────────────
      // STT (Deepgram, 300–700ms) and context loading (Supabase, ~100–200ms)
      // are independent — run them in parallel for a free ~300–700ms gain.
      const form    = await req.formData()
      const audio   = form.get('audio') as Blob | null
      timezone      = (form.get('timezone') as string | null) ?? 'UTC'
      const histRaw = form.get('history') as string | null
      if (histRaw) {
        try {
          clientHistory = sanitiseClientHistory(JSON.parse(histRaw))
        } catch { clientHistory = [] }
      }
      if (!audio) return jsonResponse({ error: 'No audio provided' }, 400)

      // Fire STT, context load AND keyword-boost roster simultaneously.
      // The boost roster is a small query (~50ms) that biases Deepgram toward
      // the business's real client first-names — STT accuracy on proper nouns
      // depends on it. Running it in parallel preserves the existing parallel
      // gain and adds negligible latency.
      const [transcript, [ctx, sessionResult]] = await Promise.all([
        getClientFirstNamesForBoost(supabase, userCtx.businessId)
          .catch(() => [] as string[])
          .then(keywords => transcribe(audio, { keywords })),
        Promise.all([
          loadBusinessContext(supabase, userCtx.businessId, timezone),
          loadSession(userCtx.userId, clientHistory),
        ]),
      ])

      inputText     = transcript
      transcription = transcript
      context       = ctx
      history       = sessionResult.session.messages
      sessionLastRef = sessionResult.session.lastRef ?? null

      // Noise / gibberish guard (audio path — applied after STT resolves)
      const MEANINGFUL_AUDIO = /[a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9]/
      if (inputText.length < 3 || !MEANINGFUL_AUDIO.test(inputText)) {
        await recordEarlyExitTrace(userCtx, timezone, inputText, 'no_action', 'STT_NOISE')
        return jsonResponse({ error: 'No logré captar lo que dijiste. ¿Puedes repetir?' }, 422)
      }

      console.log(`[VOICE-WORKER] Request (audio): user=${userCtx.userId.slice(0, 8)} biz=${userCtx.businessId.slice(0, 8)} tz=${timezone} text="${inputText.slice(0, 80)}"`)
      console.log(`[VOICE-WORKER] history source=${sessionResult.source} length=${history.length} lastRef=${sessionLastRef ? sessionLastRef.clientName : '\u2205'}`)
    }
  } catch (err) {
    console.error('[VOICE-WORKER] Payload parse or context load failed', err)
    return jsonResponse({ error: 'Payload inválido o error de contexto' }, 400)
  }

  // 5. Run the agent
  const agentInput: AgentInput = {
    text:       inputText,
    userId:     userCtx.userId,
    userName:   userCtx.userName,
    userRole:   userCtx.userRole,
    businessId: userCtx.businessId,
    timezone,
    history,
    context,
    lastRef:    sessionLastRef ? {
      appointmentId: sessionLastRef.appointmentId,
      clientName:    sessionLastRef.clientName,
      serviceName:   sessionLastRef.serviceName,
      date:          sessionLastRef.date,
      time:          sessionLastRef.time,
    } : null,
  }
  // Build the user-side text corpus for anti-hallucination guards.
  // Frame-boundary semantics live in core/conversation/frame.ts.
  const { corpus: userTextCorpus, cutoff, relevantTurns } = buildUserCorpus(inputText, history)
  console.log(`[VOICE-WORKER] corpus cutoff=${cutoff} relevantTurns=${relevantTurns} corpus="${userTextCorpus.slice(0, 120)}"`)

  const toolCtx: ToolContext = {
    supabase,
    businessId:  userCtx.businessId,
    userId:      userCtx.userId,
    timezone,
    workingHours: context.workingHours ?? undefined,
    userTextCorpus,
  }

  let agentResult
  try {
    agentResult = await runAgent(toolCtx, agentInput)
  } catch (err) {
    console.error('[VOICE-WORKER] Agent loop failed', err)
    return jsonResponse({ error: 'El asistente falló al procesar tu solicitud. Intenta de nuevo.' }, 500)
  }

  // 6. Side-effects in parallel: save session + fire notifications.
  // If the agent reported a new lastRefCandidate this turn, that wins;
  // otherwise the previous ref is preserved (pruneStaleRef ages it out at
  // ten minutes inside core/session.ts).
  const nextLastRef = agentResult.lastRefCandidate
    ? { ...agentResult.lastRefCandidate, setAt: Date.now() }
    : sessionLastRef
  await Promise.all([
    saveSession(userCtx.userId, {
      messages: agentResult.history,
      lastRef:  nextLastRef,
    }),
    ...agentResult.pendingNotifications.map(n => dispatchBellNotification(supabase, n)),
  ])

  // 7. TTS is no longer synthesised here.
  //
  // Synthesising the audio inside this Edge Function added 200–450 ms to
  // every response. Instead we return `audioUrl: null` and rely on the
  // client's existing fallback path (voice-assistant-fab.tsx) which
  // streams from `/api/assistant/tts?t=<text>` — same Deepgram provider,
  // but the roundtrip overlaps with the user's perceptual gap between
  // "request done" and "speaker starts" rather than blocking the response.
  const totalMs = Date.now() - t0
  console.log(`[VOICE-WORKER] Done in ${totalMs}ms — model=${agentResult.modelUsed} action=${agentResult.actionPerformed} (tts deferred to client)`)

  const body: VoiceWorkerResponse = {
    text:            agentResult.text,
    audioUrl:        null,
    actionPerformed: agentResult.actionPerformed,
    transcription,
    modelUsed:       agentResult.modelUsed,
  }
  return jsonResponse(body)
}

serve(handleRequest)
