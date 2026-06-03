/**
 * Supabase Edge Function — export-ai-traces
 *
 * Runs daily at 03:00 UTC via pg_cron. For each business, samples up to 500
 * rows from ai_traces in the trailing 24h, transforms them into the versioned
 * TrainingSample shape, and writes one row to ai_training_exports.
 *
 * Cero PII: only structural signals (outcome, tool_sequence, error_code,
 * latency/tokens buckets, intent, counts).
 *
 * Security: Authorization: Bearer <CRON_SECRET>.
 *
 * Required Supabase Secrets:
 *   CRON_SECRET               — shared with pg_cron trigger
 *   SUPABASE_URL              — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Deploy:
 *   npx supabase functions deploy export-ai-traces
 */

import { createClient } from '@supabase/supabase-js'
import { initSentry, captureException, addBreadcrumb, flushSentry } from '../_shared/sentry.ts'
import { buildExportSummary } from '../_shared/training/TrainingExporter.ts'
import { TRAINING_SCHEMA_VERSION }     from '../_shared/training/contracts.ts'
import type { SampleRow }              from '../_shared/training/contracts.ts'

initSentry('export-ai-traces')

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SAMPLE_LIMIT = 500

interface RpcRow {
  trace_id:      string
  created_at:    string
  channel:       SampleRow['channel']
  outcome:       SampleRow['outcome']
  error_code:    string | null
  total_tokens:  number
  latency_ms:    number
  steps_count:   number
  tools_count:   number
  tool_sequence: string[]
  intent:        string | null
}

function rpcRowToSampleRow(r: RpcRow): SampleRow {
  return {
    traceId:      r.trace_id,
    createdAt:    r.created_at,
    channel:      r.channel,
    outcome:      r.outcome,
    errorCode:    r.error_code,
    totalTokens:  r.total_tokens,
    latencyMs:    r.latency_ms,
    stepsCount:   r.steps_count,
    toolsCount:   r.tools_count,
    toolSequence: r.tool_sequence ?? [],
    intent:       r.intent,
  }
}

// @ts-ignore — Deno runtime global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // @ts-ignore — Deno runtime global
  const cronSecret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    await flushSentry()
    return json({ error: 'Unauthorized' }, 401)
  }

  // @ts-ignore — Deno runtime global
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  // @ts-ignore — Deno runtime global
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase    = createClient(supabaseUrl, serviceKey)

  const rangeEnd   = new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 24 * 60 * 60 * 1000)
  const rangeStartIso = rangeStart.toISOString()
  const rangeEndIso   = rangeEnd.toISOString()

  addBreadcrumb('Export window computed', 'cron', 'info', { start: rangeStartIso, end: rangeEndIso })

  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('id')

  if (bizErr || !businesses) {
    captureException(bizErr ?? new Error('businesses fetch returned null'), { stage: 'fetch_businesses' })
    await flushSentry()
    return json({ error: bizErr?.message ?? 'no businesses' }, 500)
  }

  const results = { processed: 0, exported: 0, skipped_empty: 0, failed: 0 }

  for (const biz of businesses) {
    results.processed++
    const businessId = (biz as { id: string }).id

    const { data: rows, error: rpcErr } = await supabase
      .rpc('ai_traces_sample_window', {
        p_business_id: businessId,
        p_range_start: rangeStartIso,
        p_range_end:   rangeEndIso,
        p_limit:       SAMPLE_LIMIT,
      })

    if (rpcErr) {
      results.failed++
      captureException(rpcErr, { stage: 'rpc_sample_window', business_id: businessId })
      continue
    }

    const sampleRows = ((rows ?? []) as RpcRow[]).map(rpcRowToSampleRow)
    if (sampleRows.length === 0) { results.skipped_empty++; continue }

    const summary = buildExportSummary(sampleRows, rangeStartIso, rangeEndIso)

    const { error: insertErr } = await supabase
      .from('ai_training_exports')
      .insert({
        business_id:    businessId,
        range_start:    rangeStartIso,
        range_end:      rangeEndIso,
        sample_count:   summary.sampleCount,
        jsonl:          summary.samples,
        schema_version: TRAINING_SCHEMA_VERSION,
      })

    if (insertErr) {
      results.failed++
      captureException(insertErr, { stage: 'insert_export', business_id: businessId })
      continue
    }

    results.exported++
  }

  await flushSentry()
  return json({ ok: true, range: { start: rangeStartIso, end: rangeEndIso }, ...results })
})
