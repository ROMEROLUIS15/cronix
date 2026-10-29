/**
 * signature.ts — Authenticates a request of the voice call agent (contract §2).
 *
 * There is no Cronix user behind a call: the agent signs
 * `timestamp + "." + METHOD + "." + route + "." + body` with a shared secret, where
 * `route` is the path from `/v1/` with its query string (so availability's query
 * parameters are signed too). Timestamps more than 300 s from the server clock are refused.
 */

import { constantTimeEqual, hmacSha256Hex } from '../_shared/hmac.ts'

export const MAX_CLOCK_SKEW_S = 300

export interface SignedRequest {
  method:    string
  route:     string
  body:      string
  timestamp: string | null
  signature: string | null
}

export async function isSignedByTheAgent(
  request: SignedRequest,
  secret:  string,
  nowMs:   number = Date.now(),
): Promise<boolean> {
  const { method, route, body, timestamp, signature } = request
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_S) return false
  const expected = await hmacSha256Hex(secret, `${timestamp}.${method}.${route}.${body}`)
  return constantTimeEqual(expected, signature.toLowerCase())
}
