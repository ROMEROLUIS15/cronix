/**
 * Provider registry — env-var-driven selection with optional fallback chain.
 *
 * Selection rules:
 *   LLM_PROVIDER=groq                 → only Groq (default — preserves prior behavior)
 *   LLM_PROVIDER=gemini               → only Gemini
 *   LLM_PROVIDER=gemini,groq          → try Gemini first, fall back to Groq on error
 *   (unset)                           → defaults to "groq"
 *
 * To add a new provider in the future:
 *   1. Implement ILLMProvider in a new file (e.g. ClaudeProvider.ts)
 *   2. Register it in PROVIDER_FACTORY below
 *   3. Set LLM_PROVIDER=claude (or include in the chain)
 *   No changes to agent.ts required.
 */

import type { ILLMProvider, ChatRequest, ChatResponse } from './ILLMProvider.ts'
import { GroqProvider }   from './GroqProvider.ts'
import { GeminiProvider } from './GeminiProvider.ts'

type ProviderFactory = () => ILLMProvider

const PROVIDER_FACTORY: Record<string, ProviderFactory> = {
  groq:   () => new GroqProvider(),
  gemini: () => new GeminiProvider(),
}

/**
 * Composite provider: tries each underlying provider in order, falls back to
 * the next on any error (with a warning log). Preserves the modelUsed of
 * whichever provider actually succeeded.
 */
class FallbackChain implements ILLMProvider {
  readonly name: string

  constructor(private readonly chain: ILLMProvider[]) {
    this.name = chain.map(p => p.name).join('+')
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let lastErr: unknown = null
    for (let i = 0; i < this.chain.length; i++) {
      const provider = this.chain[i]!
      try {
        return await provider.chat(req)
      } catch (err) {
        lastErr = err
        const reason = err instanceof Error ? err.message : String(err)
        const next = this.chain[i + 1]
        if (next) {
          console.warn(`[PROVIDER-CHAIN] ${provider.name} failed, falling back to ${next.name}: ${reason}`)
          continue
        }
        // Last in chain — propagate
      }
    }
    throw lastErr ?? new Error('All providers in chain exhausted')
  }
}

/**
 * Resolves the configured provider. Memoized per-process — instances are
 * cheap but re-creating on every invocation is wasteful in long-lived Edge
 * runtime workers.
 */
let memoized: ILLMProvider | null = null

export function getProvider(): ILLMProvider {
  if (memoized) return memoized

  const raw = Deno.env.get('LLM_PROVIDER') ?? 'groq'
  const names = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

  if (names.length === 0) {
    throw new Error(`LLM_PROVIDER is empty after parsing: "${raw}"`)
  }

  const providers: ILLMProvider[] = names.map(name => {
    const factory = PROVIDER_FACTORY[name]
    if (!factory) {
      throw new Error(`Unknown LLM provider "${name}". Valid: ${Object.keys(PROVIDER_FACTORY).join(', ')}`)
    }
    return factory()
  })

  memoized = providers.length === 1 ? providers[0]! : new FallbackChain(providers)
  console.log(`[PROVIDER-REGISTRY] Selected: ${memoized.name}`)
  return memoized
}

/** Test-only helper — clears the memoized provider. */
export function _resetProviderForTests(): void {
  memoized = null
}
