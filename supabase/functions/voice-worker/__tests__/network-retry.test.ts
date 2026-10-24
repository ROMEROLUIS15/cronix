/**
 * A pooled HTTP/2 connection that Deepgram closed while idle makes `fetch`
 * throw ("connection error received: not a result of an error"). One retry
 * recovers it; an HTTP error response (400 for corrupt audio) is never retried.
 */

import { describe, it, expect, vi } from 'vitest'
import { fetchWithNetworkRetry } from '../core/network-retry.ts'

const ok = new Response('{}', { status: 200 })
const connectionReset = new TypeError('client error (SendRequest): http2 error: connection error received: not a result of an error')

describe('fetchWithNetworkRetry', () => {
  it('retries once when the request fails at the network level', async () => {
    const request = vi.fn<() => Promise<Response>>()
      .mockRejectedValueOnce(connectionReset)
      .mockResolvedValueOnce(ok)
    await expect(fetchWithNetworkRetry(request, 0)).resolves.toBe(ok)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('returns an HTTP error response as-is, without retrying', async () => {
    const badAudio = new Response('corrupt or unsupported data', { status: 400 })
    const request = vi.fn<() => Promise<Response>>().mockResolvedValue(badAudio)
    await expect(fetchWithNetworkRetry(request, 0)).resolves.toBe(badAudio)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry and surfaces the second error', async () => {
    const stillDown = new TypeError('dns error')
    const request = vi.fn<() => Promise<Response>>()
      .mockRejectedValueOnce(connectionReset)
      .mockRejectedValueOnce(stillDown)
    await expect(fetchWithNetworkRetry(request, 0)).rejects.toBe(stillDown)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
