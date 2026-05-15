/**
 * voice-worker Edge Function — entry point.
 *
 * Pipeline:
 *   1. Parse multipart form (audio + timezone) OR JSON ({text, timezone})
 *   2. Validate JWT (auto-handled by verify_jwt=true in supabase/config.toml)
 *   3. Resolve user → business
 *   4. Rate limit check (per user, 30/min)
 *   5. STT via Groq Whisper (skip if input is text)
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

import { transcribe }            from './stt.ts'
import { synthesizeAudio }       from './tts.ts'
import { runAgent }              from './agent.ts'
import { dispatchBellNotification } from './notifications.ts'
import { checkRateLimit }         from './redis.ts'
import { loadSession, saveSession } from './core/session.ts'
import type { ToolContext }      from './tools.ts'
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

// deno-lint-ignore no-explicit-any
async function resolveUserAndBusiness(supabase: any, authHeader: string): Promise<UserContext | null> {
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return null

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

  return {
    userId:     profile.id as string,
    userName:   (profile.name as string | null) ?? 'Usuario',
    userRole:   ((profile.role as string | null) ?? 'employee') as UserRole,
    businessId: profile.business_id as string,
  }
}

// ── Business context loader ────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function loadBusinessContext(supabase: any, businessId: string, timezone: string): Promise<BusinessContext> {
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: timezone })

  const [bizRes, servicesRes, apptsRes] = await Promise.all([
    supabase.from('businesses').select('name, settings').eq('id', businessId).single(),
    supabase.from('services').select('id, name, duration_min, price').eq('business_id', businessId).eq('is_active', true),
    supabase.from('appointments')
      .select('start_at, client:clients(name), service:services(name)')
      .eq('business_id', businessId)
      .neq('status', 'cancelled')
      .gte('start_at', `${todayLocal}T00:00:00`)
      .lte('start_at', `${todayLocal}T23:59:59`)
      .order('start_at'),
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
    return jsonResponse({ error: `Demasiadas solicitudes. Reintenta en ${rl.retryAfter}s.` }, 429)
  }

  // 3. Parse payload (audio multipart OR text json)
  let inputText = ''
  let timezone  = 'UTC'
  let transcription = ''
  let clientHistory: AgentInput['history'] = []

  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = await req.json() as {
        text?:     string
        timezone?: string
        history?:  AgentInput['history']
      }
      inputText = (body.text ?? '').trim()
      timezone  = body.timezone ?? 'UTC'
      clientHistory = sanitiseClientHistory(body.history)
      transcription = inputText
    } else {
      const form = await req.formData()
      const audio = form.get('audio') as Blob | null
      timezone    = (form.get('timezone') as string | null) ?? 'UTC'
      const histRaw = form.get('history') as string | null
      if (histRaw) {
        try {
          clientHistory = sanitiseClientHistory(JSON.parse(histRaw))
        } catch { clientHistory = [] }
      }
      if (!audio) return jsonResponse({ error: 'No audio provided' }, 400)
      inputText = await transcribe(audio)
      transcription = inputText
    }
  } catch (err) {
    console.error('[VOICE-WORKER] Payload parse failed', err)
    return jsonResponse({ error: 'Payload inválido' }, 400)
  }

  // Noise / gibberish guard
  const MEANINGFUL = /[a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9]/
  if (inputText.length < 3 || !MEANINGFUL.test(inputText)) {
    return jsonResponse({ error: 'No logré captar lo que dijiste. ¿Puedes repetir?' }, 422)
  }

  console.log(`[VOICE-WORKER] Request: user=${userCtx.userId.slice(0, 8)} biz=${userCtx.businessId.slice(0, 8)} tz=${timezone} text="${inputText.slice(0, 80)}"`)

  // 4. Load context + session in parallel.
  // The session cascade lives in core/session.ts: Redis → client-history → []
  let context: BusinessContext
  let history: AgentInput['history']
  let sessionLastRef: import('./core/session.ts').LastReferencedAppointment | null = null
  try {
    const [ctx, sessionResult] = await Promise.all([
      loadBusinessContext(supabase, userCtx.businessId, timezone),
      loadSession(userCtx.userId, clientHistory),
    ])
    context        = ctx
    history        = sessionResult.session.messages
    sessionLastRef = sessionResult.session.lastRef ?? null
    console.log(`[VOICE-WORKER] history source=${sessionResult.source} length=${history.length} lastRef=${sessionLastRef ? sessionLastRef.clientName : '∅'}`)
  } catch (err) {
    console.error('[VOICE-WORKER] Context load failed', err)
    return jsonResponse({ error: 'No se pudo cargar el contexto del negocio' }, 500)
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
  // Build the user-side text corpus (current turn + recent user messages)
  // so smart_schedule can reject hallucinated services. Capped to keep the
  // string small — only the *user* side matters here, never assistant.
  const userCorpusParts = [inputText]
  for (const m of history) if (m.role === 'user') userCorpusParts.push(m.content)
  const userTextCorpus = userCorpusParts.join(' ').slice(0, 4000)

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

  // 7. TTS (synchronous — needed before response)
  const audioUrl = await synthesizeAudio(agentResult.text)

  const totalMs = Date.now() - t0
  console.log(`[VOICE-WORKER] Done in ${totalMs}ms — model=${agentResult.modelUsed} action=${agentResult.actionPerformed} hasAudio=${!!audioUrl}`)

  const body: VoiceWorkerResponse = {
    text:            agentResult.text,
    audioUrl,
    actionPerformed: agentResult.actionPerformed,
    transcription,
    modelUsed:       agentResult.modelUsed,
  }
  return jsonResponse(body)
}

serve(handleRequest)
