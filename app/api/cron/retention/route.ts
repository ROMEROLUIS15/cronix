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
} from '@/lib/domain/use-cases/retention'
import { WinbackMessenger } from '@/lib/services/winback-messenger'

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

  const totals = { businesses: 0, sent: 0, failed: 0, capped: 0 }
  for (const businessId of enabled.data) {
    totals.businesses++
    const result = await processRetention.execute({ businessId })
    if (result.data) {
      totals.sent += result.data.sent
      totals.failed += result.data.failed
      if (result.data.capped) totals.capped++
    }
  }

  return NextResponse.json({ ok: true, ...totals })
}

export const POST = handler
export const GET = handler
