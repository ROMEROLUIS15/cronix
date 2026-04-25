// ── VOICE ASSISTANT QSTASH WORKER ────────────────────────────────────────────
// Called by QStash (not by users). Performs the heavy AI work asynchronously:
//   LLM orchestration + TTS synthesis → saves result to Redis job hash.
//
// Retry contract:
//   - Returns HTTP 500 on transient errors → QStash retries (up to 4 calls total)
//   - Returns HTTP 200 on success OR when max attempts exhausted (mark failed)
//   - Attempts counter in Redis ensures we never exceed MAX_ATTEMPTS orchestration runs
//
// Environment variables required:
//   QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY — for signature verification
//   LLM_API_KEY / GROQ_API_KEY                          — for LLM + STT
//   DEEPGRAM_AURA_API_KEY                               — for TTS
// ─────────────────────────────────────────────────────────────────────────────
import { Receiver } from '@upstash/qstash'
import { logger } from '@/lib/logger'
import { jobStore } from '@/lib/ai/job-store'
import { createAdminClient } from '@/lib/supabase/server'
import { getRepos } from '@/lib/repositories'
import { createProductionOrchestrator } from '@/lib/ai/orchestrator/orchestrator-factory'
import { sessionStore } from '@/lib/ai/session-store'
import { checkTokenQuota, recordTokenUsage } from '@/lib/rate-limit/token-quota'
import { DeepgramProvider } from '@/lib/ai/providers/deepgram-provider'
import { shieldOutput } from '@/lib/ai/output-shield'
import type { AiInput, UserRole } from '@/lib/ai/orchestrator'
import type { LlmMessage } from '@/lib/ai/providers/types'

// ── CONFIG ────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3

const GROQ_API_KEY     = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_AURA_API_KEY

const ttsEngine = DEEPGRAM_API_KEY
  ? new DeepgramProvider(DEEPGRAM_API_KEY, 'aura-arcas-es')
  : null

// ── QStash signature verifier ─────────────────────────────────────────────────
// If signing keys are missing (local dev without QStash), verification is skipped.
const SIGNING_KEY     = process.env.QSTASH_CURRENT_SIGNING_KEY
const NEXT_SIGNING_KEY = process.env.QSTASH_NEXT_SIGNING_KEY

async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!SIGNING_KEY || !NEXT_SIGNING_KEY) {
    logger.warn('VOICE-WORKER', 'QStash signing keys not set — skipping signature verification (dev mode)')
    return true
  }
  const receiver = new Receiver({
    currentSigningKey: SIGNING_KEY,
    nextSigningKey:    NEXT_SIGNING_KEY,
  })
  try {
    return await receiver.verify({
      signature: req.headers.get('upstash-signature') ?? '',
      body:      rawBody,
    })
  } catch {
    return false
  }
}

// ── TTS helper ────────────────────────────────────────────────────────────────

async function generateAudio(text: string): Promise<string | null> {
  if (!ttsEngine) return null
  try {
    const shielded = shieldOutput(text, 'worker')
    const truncated = (() => {
      if (shielded.length <= 220) return shielded
      const cut     = shielded.slice(0, 220)
      const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'))
      return lastDot > 80 ? shielded.slice(0, lastDot + 1) : cut
    })()
    const res = await ttsEngine.synthesize(truncated)
    return res.audioUrl ?? null
  } catch (err) {
    logger.warn('VOICE-WORKER', 'TTS failed — result will be text-only', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ── Worker payload ────────────────────────────────────────────────────────────

interface WorkerPayload {
  job_id:      string
  user_id:     string
  business_id: string
  timezone:    string
  input_text:  string
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const isValid = await verifySignature(req, rawBody)
  if (!isValid) {
    logger.warn('VOICE-WORKER', 'Invalid QStash signature — request rejected')
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: WorkerPayload
  try {
    payload = JSON.parse(rawBody) as WorkerPayload
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  const { job_id, user_id, business_id, timezone, input_text } = payload

  if (!job_id || !user_id || !business_id || !input_text) {
    return new Response('Missing required fields', { status: 400 })
  }

  // Increment attempts counter before any work (atomic, prevents runaway retries)
  const attempts = await jobStore.incrementAttempts(job_id)

  if (attempts > MAX_ATTEMPTS) {
    // QStash exhausted all retries — produce an audible error and stop
    logger.warn('VOICE-WORKER', 'Max attempts exceeded — marking job failed', { job_id, attempts })
    const errorAudioUrl = await generateAudio('Hubo un problema al procesar tu solicitud. Por favor intenta de nuevo.')
    await jobStore.update(job_id, {
      status:         'failed',
      error:          'max_attempts_exceeded',
      resultAudioUrl: errorAudioUrl ?? undefined,
    })
    return new Response('OK', { status: 200 })
  }

  await jobStore.update(job_id, { status: 'processing' })

  if (!GROQ_API_KEY) {
    const audioUrl = await generateAudio('El servicio de inteligencia artificial no está configurado. Contacta al soporte.')
    await jobStore.update(job_id, { status: 'failed', error: 'LLM API key not configured', resultAudioUrl: audioUrl ?? undefined })
    return new Response('OK', { status: 200 })
  }

  try {
    // ── Load business context ─────────────────────────────────────────────────
    const admin = createAdminClient()
    const repos = getRepos(admin)

    const [ctxResult, bizRes] = await Promise.all([
      repos.users.getUserContextById(user_id),
      repos.businesses.getById(business_id),
    ])

    const dbUser     = ctxResult.data
    const userName   = dbUser?.name ?? 'Usuario'
    const userRole   = (dbUser?.role as string) ?? 'employee'
    const bizData    = bizRes.data
    const businessName = bizData?.name ?? 'tu negocio'
    const settings = (bizData?.settings ?? null) as Record<string, unknown> | null
    const aiRules      = typeof settings?.aiRules === 'string' ? settings.aiRules : undefined
    const workingHours = settings?.workingHours as Record<string, { open: string; close: string }> | undefined

    // ── Token quota ───────────────────────────────────────────────────────────
    const quota = await checkTokenQuota(business_id)
    if (!quota.allowed) {
      const audioUrl = await generateAudio('Has alcanzado el límite diario del asistente. Se reanudará mañana.')
      await jobStore.update(job_id, {
        status:         'failed',
        error:          'token_quota_exceeded',
        resultAudioUrl: audioUrl ?? undefined,
      })
      return new Response('OK', { status: 200 })
    }

    // ── Load session + services + today appointments ──────────────────────────
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    const [session, servicesRes, todayApptRes] = await Promise.all([
      sessionStore.getSession(user_id),
      repos.services.getActive(business_id),
      repos.appointments.getDayAppointments(business_id, todayStr),
    ])

    const serverHistory  = session.messages
    const entityContext  = session.entities as Record<string, unknown>

    // ── Build orchestrator input ──────────────────────────────────────────────
    const aiInput: AiInput = {
      text:       input_text,
      userId:     user_id,
      businessId: business_id,
      userRole:   userRole as UserRole,
      timezone,
      channel:    'web',
      history:    serverHistory,
      requestId:  job_id,
      userName,
      entityContext,
      context: {
        businessId:  business_id,
        businessName,
        timezone,
        aiRules,
        workingHours,
        services: (servicesRes.data ?? []).map((s) => ({
          id:           s.id,
          name:         s.name,
          duration_min: s.duration_min,
          price:        s.price,
        })),
        activeAppointments: (todayApptRes.data ?? [])
          .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
          .map((a) => ({
            id:          a.id,
            serviceName: (a.service as { name: string } | null)?.name ?? '',
            clientName:  (a.client as { name: string } | null)?.name ?? '',
            startAt:     a.start_at,
            endAt:       a.end_at,
            status:      a.status ?? 'pending',
          })),
      },
    }

    // ── Run orchestrator ──────────────────────────────────────────────────────
    const orchestrator = createProductionOrchestrator(admin, GROQ_API_KEY)
    const output       = await orchestrator.process(aiInput)

    // Safety net: action with empty response → generic confirmation
    const responseText = (output.actionPerformed && !output.text?.trim())
      ? 'Listo, acción completada.'
      : output.text

    // ── Persist session (strip tool messages before saving) ───────────────────
    const cleanHistory: LlmMessage[] = output.history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map((m) => ({ role: m.role, content: m.content ?? '' }))

    void sessionStore.saveSession(user_id, {
      messages:  cleanHistory,
      entities:  entityContext,
    })

    // ── Token accounting ──────────────────────────────────────────────────────
    void recordTokenUsage(business_id, output.tokens)

    // ── TTS synthesis ─────────────────────────────────────────────────────────
    const audioUrl = responseText ? await generateAudio(responseText) : null

    // ── Save completed result ─────────────────────────────────────────────────
    await jobStore.update(job_id, {
      status:          'completed',
      resultText:      responseText ?? '',
      resultAudioUrl:  audioUrl ?? undefined,
      actionPerformed: output.actionPerformed,
    })

    logger.info('VOICE-WORKER', `Job completed`, {
      job_id,
      attempts,
      toolCount: output.toolTrace.length,
      hasAudio:  Boolean(audioUrl),
      actionPerformed: output.actionPerformed,
    })

    return new Response('OK', { status: 200 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('VOICE-WORKER', `Orchestration failed on attempt ${attempts}`, { job_id, message })

    if (attempts >= MAX_ATTEMPTS) {
      // Last allowed attempt failed — mark done with audible error
      const errorAudioUrl = await generateAudio('Hubo un problema al procesar tu solicitud. Por favor intenta de nuevo.')
      await jobStore.update(job_id, {
        status:         'failed',
        error:          message,
        resultAudioUrl: errorAudioUrl ?? undefined,
      })
      return new Response('OK', { status: 200 })
    }

    // Not last attempt — return 500 so QStash retries after backoff
    return new Response('Worker error — will retry', { status: 500 })
  }
}
