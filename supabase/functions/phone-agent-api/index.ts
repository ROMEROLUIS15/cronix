/**
 * phone-agent-api — Cronix's side of the voice call agent's contract
 * (voice-call-agent: docs/specs/cronix-phone-api-contract.md).
 *
 * Every request is signed by the agent (signature.ts); the business of a call comes from
 * the call record its start created, never from a request. v1 serves the phone line:
 * start of call, availability and end of call; booking follows.
 *
 * HTTP: a business outcome answers 200 with `{ success: false, error }`; a bad signature
 * 401 with no body; a database failure 503, which the agent retries once (contract §6).
 */

import { getAdminClient } from '../_shared/supabase.ts'
import { captureException, initSentry } from '../_shared/sentry.ts'
import { isSignedByTheAgent } from './signature.ts'
import { endCall, startCall } from './calls.ts'
import { availability } from './availability-route.ts'
import type { ApiResult } from './results.ts'

initSentry('phone-agent-api')

function json(status: number, body: ApiResult | null, extra: Record<string, string> = {}): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status, headers: { 'Content-Type': 'application/json', ...extra },
  })
}

const FUNCTION_PATH = '/phone-agent-api'

/** The path after the function's name (`/v1/...`), whether or not `/functions/v1` precedes it. */
function pathOf(url: URL): string {
  const at = url.pathname.indexOf(`${FUNCTION_PATH}/`)
  return at < 0 ? '' : url.pathname.slice(at + FUNCTION_PATH.length)
}

/** The route with its query string: what the agent signs. */
export function routeOf(url: URL): string {
  return pathOf(url) + url.search
}

export async function handle(req: Request, secret: string, supabase = getAdminClient()): Promise<Response> {
  const url = new URL(req.url)
  const route = routeOf(url)
  const body = req.method === 'GET' ? '' : await req.text()
  const signed = await isSignedByTheAgent({
    method: req.method, route, body,
    timestamp: req.headers.get('x-cronix-timestamp'),
    signature: req.headers.get('x-cronix-signature'),
  }, secret)
  if (!signed) return json(401, null)

  let parsed: Record<string, unknown> = {}
  if (body) {
    try { parsed = JSON.parse(body) } catch { return json(200, { success: false, error: 'INVALID_ARGS' }) }
  }
  const path = pathOf(url)
  try {
    if (req.method === 'POST' && path === '/v1/calls/start') return json(200, await startCall(supabase, parsed))
    if (req.method === 'GET' && path === '/v1/availability') return json(200, await availability(supabase, url.searchParams))
    const end = path.match(/^\/v1\/calls\/([^/]{1,64})\/end$/)
    if (req.method === 'POST' && end) return json(200, await endCall(supabase, decodeURIComponent(end[1]!), parsed))
    return json(404, { success: false, error: 'NOT_FOUND' })
  } catch (err) {
    captureException(err, { stage: 'phone_agent_api', route: path })
    return json(503, { success: false, error: 'UNAVAILABLE' }, { 'Retry-After': '1' })
  }
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, Deno.env.get('PHONE_AGENT_SIGNING_SECRET') ?? ''))
}
