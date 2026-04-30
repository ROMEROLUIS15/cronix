/**
 * tts-factory.ts — Centralised TTS provider factory.
 *
 * Returns an ITtsProvider (or null when the API key is absent) so callers
 * never instantiate DeepgramProvider directly.  Consistent with how
 * GroqProvider is wired in orchestrator-factory.ts.
 */

import type { ITtsProvider } from './types'
import { DeepgramProvider } from './deepgram-provider'

/**
 * Create the production TTS provider from the given API key.
 * Returns null when the key is absent (e.g. local dev without credentials).
 */
export function createTtsProvider(
  apiKey: string | undefined,
  model  = 'aura-2-nestor-es',
): ITtsProvider | null {
  if (!apiKey) return null
  return new DeepgramProvider(apiKey, model)
}
