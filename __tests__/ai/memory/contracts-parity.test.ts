/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors.
 *
 * The memory contracts MUST be byte-identical between:
 *   - lib/ai/memory/contracts.ts                          (Node)
 *   - supabase/functions/_shared/memory/contracts.ts      (Deno)
 *
 * If this test ever fails, the engineer changed one file and forgot the
 * mirror. Sync them and re-run.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('memory contracts parity (Node ↔ Deno)', () => {
  it('contracts.ts is byte-identical across runtimes', () => {
    const root = resolve(__dirname, '../../..')
    const node = readFileSync(resolve(root, 'lib/ai/memory/contracts.ts'), 'utf8')
    const deno = readFileSync(resolve(root, 'supabase/functions/_shared/memory/contracts.ts'), 'utf8')

    expect(deno).toBe(node)
  })
})
