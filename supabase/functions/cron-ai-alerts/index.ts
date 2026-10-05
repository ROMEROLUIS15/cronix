/**
 * Supabase Edge Function — cron-ai-alerts
 *
 * Runs every 10 minutes via pg_cron. Asks Postgres which businesses crossed the
 * AI-failure threshold (fn_claim_ai_failure_alerts applies window, threshold and
 * cooldown) and pushes one Sentry `error` message per claimed business.
 *
 * Spec: docs/specs/modulo-observability/manifest.md §5.
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

// @deno-types="npm:@supabase/supabase-js@2/dist/module/index.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2'
import { initSentry, captureException, captureMessage, flushSentry } from '../_shared/sentry.ts'
import { handleCronAiAlerts, type ClaimResult } from './handler.ts'

initSentry('cron-ai-alerts')

Deno.serve((req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  return handleCronAiAlerts(req, {
    cronSecret:  Deno.env.get('CRON_SECRET'),
    claimAlerts: async () => {
      const { data, error } = await supabase.rpc('fn_claim_ai_failure_alerts')
      return { data, error } as ClaimResult
    },
    report:      (a) => captureMessage(a.message, a.level, a.extra, a.fingerprint),
    reportError: (err, extra) => captureException(err, extra),
    flush:       flushSentry,
  })
})
