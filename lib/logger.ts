/**
 * Centralized logger — single point of control for all app logging.
 *
 * Features:
 *  - Console output (always visible in dev, useful in prod)
 *  - Sentry integration (critical errors only, with requestId correlation)
 *  - Axiom batch ingestion (structured logs, sent in bulk every 5s)
 *  - Structured AI pipeline metrics (STT / LLM / TTS latency breakdown)
 */

import * as Sentry from '@sentry/nextjs'

type LogLevel = 'error' | 'warn' | 'info'

// ── Axiom Integration (Batch Ingestion) ──────────────────────────────────────

const AXIOM_DATASET = process.env.NEXT_PUBLIC_AXIOM_DATASET
const AXIOM_TOKEN = process.env.AXIOM_TOKEN

interface LogEntry {
  _time: string
  level: LogLevel
  tag: string
  message: string
  detail: string
  environment: string
  service: string
  requestId?: string
}

class AxiomBatcher {
  private queue: LogEntry[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly batchSize = 50
  private readonly flushInterval = 5000 // 5 seconds

  enqueue(entry: LogEntry): void {
    if (!AXIOM_TOKEN || !AXIOM_DATASET) return

    this.queue.push(entry)

    if (this.queue.length >= this.batchSize) {
      this.flush()
      return
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval)
    }
  }

  private flush(): void {
    if (this.queue.length === 0) return

    const batch = [...this.queue]
    this.queue = []

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this._send(batch).catch(() => {
      // Silent fail — logging should never crash the app
    })
  }

  private async _send(batch: LogEntry[]): Promise<void> {
    const res = await fetch(`https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    })

    if (!res.ok) {
      // Log to console so we know Axiom is failing
      console.error('[LOGGER] Axiom batch failed:', res.status, res.statusText)
    }
  }
}

const axiomer = new AxiomBatcher()

// ── AI Pipeline Metrics ───────────────────────────────────────────────────────

export interface AIPipelineMetric {
  requestId:    string
  businessId:   string
  userId:       string
  sttLatencyMs: number
  ttsLatencyMs: number
  llmSteps:     number
  /** 'router' = zero-LLM fast path resolved; 'react' = full ReAct loop used */
  intentSource: 'router' | 'react'
  toolsUsed:    string[]
  totalMs:      number
}

// ── Main Logger Logic ────────────────────────────────────────────────────────

function log(level: LogLevel, tag: string, message: string, detail?: unknown, requestId?: string): void {
  const prefix = `[${tag}]`

  // 1. Console logging (always visible)
  if (level === 'error') {
    console.error(prefix, message, detail ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, message, detail ?? '')
  } else {
    console.log(prefix, message, detail ?? '')
  }

  // 2. Axiom batch ingestion (production only)
  if (process.env.NODE_ENV === 'production') {
    axiomer.enqueue({
      _time: new Date().toISOString(),
      level,
      tag,
      message,
      detail: JSON.stringify(detail),
      environment: process.env.NODE_ENV,
      service: 'cronix-main',
      // requestId: correlate this entry with the originating HTTP request in Axiom
      ...(requestId ? { requestId } : {}),
    })
  }

  // 3. Sentry (critical errors only) — scope carries requestId for cross-system tracing
  if (level === 'error' && process.env.NODE_ENV === 'production') {
    Sentry.withScope((scope) => {
      scope.setTag('tag', tag)
      scope.setTag('component', 'logger')
      // requestId links this Sentry event to the Axiom log batch and middleware trace
      if (requestId) scope.setTag('requestId', requestId)
      scope.setExtra('detail', JSON.stringify(detail))
      scope.captureException(
        detail instanceof Error ? detail : new Error(`${prefix} ${message}`)
      )
    })
  }
}

/**
 * Emits a structured AI pipeline latency metric to Axiom.
 * Used to build Axiom dashboards tracking STT / LLM / TTS latency per request.
 * Fire-and-forget — never throws.
 */
function metric(data: AIPipelineMetric): void {
  if (process.env.NODE_ENV !== 'production') return

  // Flatten the metric into the log entry so Axiom queries don't need JSON parsing
  // Flatten metric fields into the log entry for Axiom dashboard queries (no JSON parsing needed)
  axiomer.enqueue({
    _time: new Date().toISOString(),
    level: 'info',
    tag: 'AI-METRIC',
    message: 'ai_pipeline_latency',
    detail: JSON.stringify(data),
    environment: process.env.NODE_ENV,
    service: 'cronix-main',
    // Spread last so metric fields (incl. requestId) take precedence over defaults
    ...data,
  } as LogEntry)
}

export const logger = {
  error: (tag: string, message: string, detail?: unknown, requestId?: string) =>
    log('error', tag, message, detail, requestId),
  warn:  (tag: string, message: string, detail?: unknown, requestId?: string) =>
    log('warn', tag, message, detail, requestId),
  info:  (tag: string, message: string, detail?: unknown, requestId?: string) =>
    log('info', tag, message, detail, requestId),
  /** Structured AI pipeline metric — tracked separately in Axiom dashboards */
  metric,
}
