/**
 * cron-ai-alerts — pure request handler (no Deno / npm / URL imports so it is
 * unit-testable under Vitest). `index.ts` wires the real dependencies.
 *
 * Flow: authenticate (Bearer CRON_SECRET) → claim alerts via the
 * `fn_claim_ai_failure_alerts` RPC (which applies threshold, window and the
 * per-business cooldown) → push one Sentry message per claimed alert.
 */

/** Window the SQL claim evaluates; mirrored here only for the Sentry payload. */
export const ALERT_WINDOW_MIN = 10

export const ALERT_MESSAGE = 'ai_agent_failure_threshold'

export interface ClaimedAlert {
  business_id:   string
  failure_count: number
  breakdown:     Record<string, number>
}

export interface ClaimResult {
  data:  ClaimedAlert[] | null
  error: { message: string } | null
}

export interface AlertReport {
  message:     string
  level:       'error'
  extra:       Record<string, unknown>
  fingerprint: readonly string[]
}

export interface HandlerDeps {
  cronSecret:   string | undefined
  claimAlerts:  () => Promise<ClaimResult>
  report:       (alert: AlertReport) => void
  reportError:  (error: unknown, extra: Record<string, unknown>) => void
  flush:        () => Promise<void>
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function toReport(alert: ClaimedAlert): AlertReport {
  return {
    message: ALERT_MESSAGE,
    level:   'error',
    extra: {
      business_id:   alert.business_id,
      failure_count: alert.failure_count,
      breakdown:     alert.breakdown,
      window_min:    ALERT_WINDOW_MIN,
    },
    // One Sentry issue per business, so a second tenant on fire is a new issue.
    fingerprint: [ALERT_MESSAGE, alert.business_id],
  }
}

export async function handleCronAiAlerts(req: Request, deps: HandlerDeps): Promise<Response> {
  if (!deps.cronSecret || req.headers.get('authorization') !== `Bearer ${deps.cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { data, error } = await deps.claimAlerts()
  if (error) {
    deps.reportError(new Error(`fn_claim_ai_failure_alerts failed: ${error.message}`), {
      stage: 'cron-ai-alerts.claim',
    })
    await deps.flush()
    return json({ error: error.message }, 500)
  }

  const alerts = data ?? []
  for (const alert of alerts) deps.report(toReport(alert))
  await deps.flush()

  return json({ alerts: alerts.length }, 200)
}
