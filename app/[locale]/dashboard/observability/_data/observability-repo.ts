/**
 * Read-side repository for the observability dashboard.
 * Single responsibility: SELECT from ai_traces under RLS.
 *
 * RLS already filters by current_business_id() — we still pass businessId
 * explicitly for defense in depth and so the query planner uses the
 * composite (business_id, created_at) index.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ObservabilitySummary {
  readonly total:     number
  readonly success:   number
  readonly failures:  number
  readonly noAction:  number
  readonly tokens:    number
  readonly p50Ms:     number
  readonly p95Ms:     number
}

export interface ErrorBucket {
  readonly code:  string
  readonly count: number
}

export interface TraceRow {
  readonly id:         string
  readonly createdAt:  string
  readonly channel:    string
  readonly outcome:    string
  readonly latencyMs:  number
  readonly tokens:     number
  readonly toolsCount: number
  readonly errorCode:  string | null
}

export class ObservabilityRepo {
  private static readonly WINDOW_HOURS = 24

  constructor(private readonly db: SupabaseClient) {}

  async getSummary24h(businessId: string): Promise<ObservabilitySummary> {
    const since = this.windowStart()
    const { data, error } = await this.db
      .from('ai_traces')
      .select('outcome, total_tokens, latency_ms')
      .eq('business_id', businessId)
      .gte('created_at', since)

    if (error || !data) return EMPTY_SUMMARY

    const rows = data as Array<{ outcome: string; total_tokens: number; latency_ms: number }>
    const total    = rows.length
    const success  = rows.filter((r) => r.outcome === 'success').length
    const failures = rows.filter((r) => r.outcome === 'failure' || r.outcome === 'error' || r.outcome === 'rate_limited').length
    const noAction = rows.filter((r) => r.outcome === 'no_action').length
    const tokens   = rows.reduce((sum, r) => sum + (r.total_tokens ?? 0), 0)

    const latencies = rows.map((r) => r.latency_ms ?? 0).sort((a, b) => a - b)
    const p50Ms = percentile(latencies, 0.50)
    const p95Ms = percentile(latencies, 0.95)

    return { total, success, failures, noAction, tokens, p50Ms, p95Ms }
  }

  async getTopErrors24h(businessId: string, limit = 5): Promise<ReadonlyArray<ErrorBucket>> {
    const since = this.windowStart()
    const { data, error } = await this.db
      .from('ai_traces')
      .select('error_code')
      .eq('business_id', businessId)
      .gte('created_at', since)
      .not('error_code', 'is', null)

    if (error || !data) return []

    const counts = new Map<string, number>()
    for (const row of data as Array<{ error_code: string | null }>) {
      const code = row.error_code
      if (!code) continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }

    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  async getRecentTraces(businessId: string, limit = 20): Promise<ReadonlyArray<TraceRow>> {
    const { data, error } = await this.db
      .from('ai_traces')
      .select('id, created_at, channel, outcome, latency_ms, total_tokens, tools_count, error_code')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as Array<{
      id: string; created_at: string; channel: string; outcome: string
      latency_ms: number; total_tokens: number; tools_count: number; error_code: string | null
    }>).map((r) => ({
      id:         r.id,
      createdAt:  r.created_at,
      channel:    r.channel,
      outcome:    r.outcome,
      latencyMs:  r.latency_ms,
      tokens:     r.total_tokens,
      toolsCount: r.tools_count,
      errorCode:  r.error_code,
    }))
  }

  private windowStart(): string {
    return new Date(Date.now() - ObservabilityRepo.WINDOW_HOURS * 3_600_000).toISOString()
  }
}

const EMPTY_SUMMARY: ObservabilitySummary = {
  total: 0, success: 0, failures: 0, noAction: 0, tokens: 0, p50Ms: 0, p95Ms: 0,
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx] ?? 0
}
