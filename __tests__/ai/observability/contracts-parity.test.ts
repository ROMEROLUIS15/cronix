/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors.
 *
 * Both files MUST stay byte-identical:
 *   - lib/ai/observability/contracts.ts
 *   - supabase/functions/_shared/observability/contracts.ts
 *   - lib/ai/observability/hashing.ts
 *   - supabase/functions/_shared/observability/hashing.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('observability parity (Node ↔ Deno)', () => {
  const root = resolve(__dirname, '../../..')

  it('contracts.ts is byte-identical across runtimes', () => {
    const node = readFileSync(resolve(root, 'lib/ai/observability/contracts.ts'), 'utf8')
    const deno = readFileSync(resolve(root, 'supabase/functions/_shared/observability/contracts.ts'), 'utf8')
    expect(deno).toBe(node)
  })

  it('hashing.ts is byte-identical across runtimes', () => {
    const node = readFileSync(resolve(root, 'lib/ai/observability/hashing.ts'), 'utf8')
    const deno = readFileSync(resolve(root, 'supabase/functions/_shared/observability/hashing.ts'), 'utf8')
    expect(deno).toBe(node)
  })
})
