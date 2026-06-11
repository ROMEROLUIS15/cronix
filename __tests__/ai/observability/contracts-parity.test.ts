/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors.
 *
 * Both files MUST stay byte-identical:
 *   - lib/ai/observability/contracts.ts
 *   - supabase/functions/_shared/observability/contracts.ts
 *   - lib/ai/observability/hashing.ts
 *   - supabase/functions/_shared/observability/hashing.ts
 *   - lib/ai/observability/LangSmithSink.ts
 *   - supabase/functions/_shared/observability/LangSmithSink.ts
 *   - lib/ai/observability/CompositeSink.ts
 *   - supabase/functions/_shared/observability/CompositeSink.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('observability parity (Node ↔ Deno)', () => {
  const root = resolve(__dirname, '../../..')

  const mirrored = [
    'contracts.ts',
    'hashing.ts',
    'LangSmithSink.ts',
    'CompositeSink.ts',
  ] as const

  it.each(mirrored)('%s is byte-identical across runtimes', (file) => {
    const node = readFileSync(resolve(root, `lib/ai/observability/${file}`), 'utf8')
    const deno = readFileSync(resolve(root, `supabase/functions/_shared/observability/${file}`), 'utf8')
    expect(deno).toBe(node)
  })
})
