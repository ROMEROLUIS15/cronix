/**
 * Retries `request` once when it fails at the network level — `fetch` throws,
 * e.g. on a pooled HTTP/2 connection the provider closed while idle
 * ("connection error received: not a result of an error"). An HTTP error
 * response is returned as-is: a 400 for corrupt audio must not be retried.
 */
export async function fetchWithNetworkRetry(
  request: () => Promise<Response>,
  delayMs = 250,
): Promise<Response> {
  try {
    return await request()
  } catch (err) {
    console.warn(`[VOICE-WORKER] network error, retrying once: ${err instanceof Error ? err.message : String(err)}`)
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return request()
  }
}
