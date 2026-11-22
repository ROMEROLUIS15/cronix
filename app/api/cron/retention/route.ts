/**
 * POST/GET /api/cron/retention — daily win-back run (modulo-retencion §6).
 *
 * Server-to-server only: triggered by pg_cron via net.http_post with
 * `Authorization: Bearer <CRON_SECRET>`. Uses the service-role client (no user
 * session) and runs ProcessRetentionUseCase for every Pro+ business with the
 * retention toggle on. The use-case re-checks plan + toggle per business, so
 * gating holds even if the fan-out query drifts (defense in depth).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getRepos } from '@/lib/repositories'
import {
  GetEligibleClientsUseCase,
  ProcessRetentionUseCase,
  RETENTION_LIMITS,
} from '@/lib/domain/use-cases/retention'
import { orderBusinessesForDay } from '@/lib/use-cases/retention-order'
import { WinbackMessenger } from '@/lib/services/winback-messenger'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

async function handler(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey)
  const repos = getRepos(supabase)

  const enabled = await repos.businesses.findRetentionEnabledIds()
  if (enabled.error || !enabled.data) {
    return NextResponse.json(
      { error: enabled.error ?? 'Failed to list retention-enabled businesses' },
      { status: 500 },
    )
  }

  const messenger = new WinbackMessenger()
  const getEligible = new GetEligibleClientsUseCase(repos.clients, repos.businesses)
  const processRetention = new ProcessRetentionUseCase(
    repos.businesses,
    repos.clients,
    getEligible,
    messenger,
  )

  // One daily budget for the whole platform (shared WhatsApp number), handed out in
  // an order that rotates every day; businesses past the budget wait for tomorrow.
  const totals = { businesses: 0, sent: 0, failed: 0, capped: 0, skipped: 0 }
  let budgetLeft: number = RETENTION_LIMITS.platformDaily
  for (const businessId of orderBusinessesForDay(enabled.data, new Date())) {
    if (budgetLeft <= 0) {
      totals.skipped++
      continue
    }
    totals.businesses++
    const result = await processRetention.execute({ businessId, maxSends: budgetLeft })
    if (!result.data) continue

    budgetLeft -= result.data.sent
    totals.sent += result.data.sent
    totals.failed += result.data.failed
    if (result.data.capped) totals.capped++

    // A platform-wide failure (template, account, phone number) is shared by every
    // business: the same template and number go out for all of them. Stop the
    // fan-out and report it — the message is constant so Sentry groups it.
    const { aborted } = result.data
    if (aborted) {
      logger.error('retention', 'Win-back run aborted by a platform-wide WhatsApp failure', {
        businessId,
        code: aborted.code,
        template: aborted.template,
        message: aborted.message,
      })
      return NextResponse.json(
        { ok: false, ...totals, aborted: { businessId, code: aborted.code, template: aborted.template } },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({ ok: true, ...totals })
}

export const POST = handler
export const GET = handler
